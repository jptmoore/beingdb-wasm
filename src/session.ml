(* Query/introspection over any Runtime_store.S, shaped like the native
   server's POST /query (dsl, execute) and GET /predicates?detailed=true. *)

open Beingdb_runtime

(* Drive a promise without Lwt_main/Lwt_unix (as in BeingDB's test_runtime):
   the engine only yields via Lwt.pause and the stores here resolve at once. *)
let rec run p =
  match Lwt.state p with
  | Lwt.Return v -> v
  | Lwt.Fail e -> raise e
  | Lwt.Sleep ->
      if Lwt.paused_count () = 0 then failwith "promise blocked on something other than Lwt.pause";
      Lwt.wakeup_paused ();
      run p

(* Same default as the native server's [max_results]. *)
let max_results = 1000

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

module Make (Store : Runtime_store.S) = struct
  module Engine = Query_engine.Make (Store)
  module Environment = Query_environment.Make (Store)

  type t = { store : Store.t; env : Query_environment.t }

  let open_store store = { store; env = run (Environment.load_or_build store) }
  let environment t = t.env

  let execute t (cq : Core_query.t) warnings =
    match run (Engine.execute t.store cq.query) with
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
          @ environment_fields t.env)

  let query t text : Yojson.Safe.t =
    match Query_validation.check_query_length text with
    | Error err -> failure (Query_validation.error_code err) (Query_validation.error_message err)
    | Ok () -> (
        try
          match Dsl_parser.parse text with
          | Error message -> invalid t.env [ `Assoc [ ("code", `String "syntax_error"); ("message", `String message) ] ] []
          | Ok surface -> (
              match Dsl_lower.lower t.env surface with
              | { errors = _ :: _ as errors; warnings; _ } ->
                  invalid t.env (List.map Validation_error.to_json errors) (List.map Validation_error.warning_to_json warnings)
              | { core_query = None; _ } -> failure "internal_error" "lowering produced neither a query nor errors"
              | { core_query = Some cq; warnings; _ } -> execute t cq warnings)
        with exn -> failure "internal_error" (Printf.sprintf "Query error: %s" (Printexc.to_string exn)))

  let predicates t : Yojson.Safe.t =
    let predicate_json (p : Query_environment.predicate_signature) =
      `Assoc
        [
          ("name", `String p.name);
          ("arity", `Int p.arity);
          ("count", `Int p.count);
          ( "arguments",
            `List
              (List.map
                 (fun (a : Query_environment.argument_signature) ->
                   `Assoc [ ("position", `Int a.position); ("types", strings a.types) ])
                 p.arguments) );
          ("examples", `List (List.map (fun args -> `List (List.map Value.to_json args)) p.examples));
        ]
    in
    `Assoc
      [
        ("predicates", `List (List.map predicate_json t.env.predicates));
        ("environmentFingerprint", `String t.env.fingerprint);
        ("languageVersion", `String t.env.language_version);
      ]
end
