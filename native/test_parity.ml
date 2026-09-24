(* Parity: native BeingDB over Irmin Pack vs the exported logical view read
   through Export_reader, both via the same Pack_layout and query engine, and
   both against goldens recorded from the native BeingDB server. *)

open Beingdb_runtime
module Pack_backend = Beingdb_pack_unix.Pack_backend
module W = Beingdb_wasm
module Native_session = W.Session.Make (Pack_backend)

let pack_path = Option.value (Sys.getenv_opt "BEINGDB_PACK") ~default:"../../../../beingdb/pack_store"
let export_file = "data/rewind.browser.json"
let native = lazy (Lwt_main.run (Pack_backend.init ~readonly:true pack_path))

let export_tree =
  lazy
    (match W.Export_reader.of_string (In_channel.with_open_bin export_file In_channel.input_all) with
    | Ok t -> t
    | Error e -> failwith e)

let golden = lazy (Yojson.Safe.from_file "fixtures/rewind_golden.json")
let queries = lazy (Yojson.Safe.Util.(to_list (Yojson.Safe.from_file "fixtures/rewind_queries.json")))
let json = Alcotest.testable Yojson.Safe.pretty_print Yojson.Safe.equal

(* Row order is unspecified; compare results as a sorted multiset. *)
let normalize = function
  | `Assoc kvs ->
      `Assoc
        (List.map
           (function
             | "results", `List rows -> ("results", `List (List.sort compare rows))
             | kv -> kv)
           kvs)
  | j -> j

let test_export_reproducible () =
  let fresh = Lwt_main.run (Pack_export.export (Lazy.force native)) in
  Alcotest.check json "re-export equals data file" (Yojson.Safe.from_file export_file) fresh

let encoded facts = List.map Fact.encode facts

let test_storage () =
  let n = Lazy.force native and e = Lazy.force export_tree in
  let run = Lwt_main.run in
  let preds = run (Pack_backend.list_predicates n) in
  Alcotest.(check (list string)) "predicates (same order)" preds (run (W.Export_store.list_predicates e));
  Alcotest.(check int) "168 predicates" 168 (List.length preds);
  let total =
    List.fold_left
      (fun acc p ->
        let manifest store get = Option.map (fun m -> Manifest.to_json m) (run (get store p)) in
        Alcotest.(check (option json)) ("manifest " ^ p) (manifest n Pack_backend.get_manifest)
          (manifest e W.Export_store.get_manifest);
        let facts = run (Pack_backend.query_all n p) in
        Alcotest.(check (list string)) ("facts " ^ p) (encoded facts) (encoded (run (W.Export_store.query_all e p)));
        acc + List.length facts)
      0 preds
  in
  Alcotest.(check int) "all fact bodies decode" total (List.length (run (W.Export_reader.list e [ "facts" ])))

let export_session = lazy (W.Export_session.open_store (Lazy.force export_tree))
let native_session = lazy (Native_session.open_store (Lazy.force native))

let test_predicates () =
  let g = Yojson.Safe.Util.member "predicates" (Lazy.force golden) in
  Alcotest.check json "native session = server" g (Native_session.predicates (Lazy.force native_session));
  Alcotest.check json "export session = server" g (W.Export_session.predicates (Lazy.force export_session))

let test_query q () =
  let open Yojson.Safe.Util in
  let name = to_string (member "name" q) and text = to_string (member "query" q) in
  let expected = normalize (Lazy.force golden |> member "queries" |> member name) in
  Alcotest.check json "native session = server" expected (normalize (Native_session.query (Lazy.force native_session) text));
  Alcotest.check json "export session = server" expected (normalize (W.Export_session.query (Lazy.force export_session) text))

let () =
  let query_cases =
    List.map
      (fun q -> Alcotest.test_case Yojson.Safe.Util.(to_string (member "name" q)) `Quick (test_query q))
      (Lazy.force queries)
  in
  Alcotest.run "Rewind pack parity"
    [
      ( "export",
        [ Alcotest.test_case "reproducible" `Quick test_export_reproducible; Alcotest.test_case "storage" `Quick test_storage ] );
      ("introspection", [ Alcotest.test_case "predicates" `Quick test_predicates ]);
      ("queries", query_cases);
    ]
