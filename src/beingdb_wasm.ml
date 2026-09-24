(* Browser-facing state: the Phase 1 fixture in Memory_store until an export
   of a real compiled pack is loaded, then that export. *)

open Beingdb_runtime
module Session = Session
module Export_reader = Export_reader
module Export_store = Pack_layout.Make (Export_reader)
module Fixture_session = Session.Make (Memory_store)
module Export_session = Session.Make (Export_store)

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

type dataset = { query : string -> Yojson.Safe.t; predicates : unit -> Yojson.Safe.t }

let fixture_dataset =
  lazy
    (let s = Fixture_session.open_store (Memory_store.of_facts fixture) in
     { query = Fixture_session.query s; predicates = (fun () -> Fixture_session.predicates s) })

let current = ref None
let dataset () = match !current with Some d -> d | None -> Lazy.force fixture_dataset
let query text = (dataset ()).query text
let predicates () = (dataset ()).predicates ()

(* Load an exported logical pack view; returns a summary, or {"error": ...}. *)
let load text : Yojson.Safe.t =
  match Export_reader.of_string text with
  | Error message -> Session.failure "invalid_export" message
  | Ok tree ->
      let s = Export_session.open_store tree in
      current := Some { query = Export_session.query s; predicates = (fun () -> Export_session.predicates s) };
      let env = Export_session.environment s in
      `Assoc
        [
          ("predicates", `Int (List.length env.predicates));
          ("facts", `Int (List.length (Session.run (Export_reader.list tree [ "facts" ]))));
          ("entries", `Int (Export_reader.entry_count tree));
          ("environmentFingerprint", `String env.fingerprint);
          ("languageVersion", `String env.language_version);
        ]

let query_string text = Yojson.Safe.to_string (query text)
