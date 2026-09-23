(* Run a BeingDB DSL query against a tiny in-memory fixture, using only the
   portable runtime. The response shapes mirror the native server's
   [POST /query] (language "dsl", action "execute"). *)

open Beingdb_runtime
module Engine = Query_engine.Make (Memory_store)
module Environment = Query_environment.Make (Memory_store)

let atom s = Value.Atom s

let fixture =
  [
    Fact.make "person" [ atom "artist_1" ];
    Fact.make "person" [ atom "artist_2" ];
    Fact.make "created_by" [ atom "work_1"; atom "artist_1" ];
    Fact.make "created_by" [ atom "work_2"; atom "artist_2" ];
    Fact.make "created_by" [ atom "work_3"; atom "artist_1" ];
    Fact.make "year_created" [ atom "work_1"; Value.Year 1979 ];
    Fact.make "year_created" [ atom "work_2"; Value.Year 1985 ];
    Fact.make "year_created" [ atom "work_3"; Value.Year 1968 ];
  ]

(* Same default as the native server's [max_results]. *)
let max_results = 1000

(* Drive a promise to completion without Lwt_main/Lwt_unix (as in BeingDB's
   test_runtime): the engine only yields via Lwt.pause and Memory_store
   resolves immediately. *)
let rec run p =
  match Lwt.state p with
  | Lwt.Return v -> v
  | Lwt.Fail e -> raise e
  | Lwt.Sleep ->
      if Lwt.paused_count () = 0 then failwith "promise blocked on something other than Lwt.pause";
      Lwt.wakeup_paused ();
      run p

let store = lazy (Memory_store.of_facts fixture)
let environment = lazy (run (Environment.load_or_build (Lazy.force store)))

let strings l = `List (List.map (fun s -> `String s) l)

let environment_fields (env : Query_environment.t) =
  [
    ("language", `String "dsl");
    ("languageVersion", `String env.language_version);
    ("environmentFingerprint", `String env.fingerprint);
  ]

let invalid env errors warnings =
  `Assoc ([ ("valid", `Bool false); ("errors", `List errors); ("warnings", `List warnings) ] @ environment_fields env)

let failure code message = `Assoc [ ("error", `Assoc [ ("code", `String code); ("message", `String message) ]) ]

let row_to_json vars row =
  `Assoc (List.map2 (fun v cell -> (v, match cell with Some x -> Value.to_json x | None -> `Null)) vars row)

let execute env (cq : Core_query.t) warnings =
  match run (Engine.execute (Lazy.force store) cq.query) with
  | Error message -> failure "execution_error" message
  | Ok result ->
      let limit = match cq.limit with Some n -> min n max_results | None -> max_results in
      let vars, rows = Core_query.apply { cq with limit = Some limit } result in
      `Assoc
        ([
           ("variables", strings vars);
           ("results", `List (List.map (row_to_json vars) rows));
           ("count", `Int (List.length rows));
           ("warnings", `List (List.map Validation_error.warning_to_json warnings));
         ]
        @ environment_fields env)

let query text : Yojson.Safe.t =
  match Query_validation.check_query_length text with
  | Error err -> failure (Query_validation.error_code err) (Query_validation.error_message err)
  | Ok () -> (
      try
        let env = Lazy.force environment in
        match Dsl_parser.parse text with
        | Error message -> invalid env [ `Assoc [ ("code", `String "syntax_error"); ("message", `String message) ] ] []
        | Ok surface -> (
            match Dsl_lower.lower env surface with
            | { errors = _ :: _ as errors; warnings; _ } ->
                invalid env (List.map Validation_error.to_json errors) (List.map Validation_error.warning_to_json warnings)
            | { core_query = None; _ } -> failure "internal_error" "lowering produced neither a query nor errors"
            | { core_query = Some cq; warnings; _ } -> execute env cq warnings)
      with exn -> failure "internal_error" (Printf.sprintf "Query error: %s" (Printexc.to_string exn)))

let query_string text = Yojson.Safe.to_string (query text)
