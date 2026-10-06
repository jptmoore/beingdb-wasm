open Yojson.Safe.Util

let example = "find Artist, Work, Y\nwhere\n  created_by(Work, Artist)\n  year_created(Work, Y)\n  Y >= 1970\n"

let rows json =
  let vars = json |> member "variables" |> to_list |> List.map to_string in
  json |> member "results" |> to_list
  |> List.map (fun row -> String.concat "," (List.map (fun v -> row |> member v |> member "value" |> to_string) vars))
  |> List.sort String.compare

let test_join_and_range () =
  let r = Beingdb_wasm.query example in
  Alcotest.(check (list string)) "variables" [ "Artist"; "Work"; "Y" ] (r |> member "variables" |> to_list |> List.map to_string);
  Alcotest.(check (list string)) "rows" [ "artist_1,work_1,1979"; "artist_2,work_2,1985" ] (rows r);
  Alcotest.(check int) "count" 2 (r |> member "count" |> to_int);
  Alcotest.(check string) "language" "dsl" (r |> member "language" |> to_string);
  Alcotest.(check string) "typed value" "year"
    (r |> member "results" |> index 0 |> member "Y" |> member "type" |> to_string)

let test_three_way_join () =
  let r = Beingdb_wasm.query "find Artist, Work\nwhere\n  person(Artist)\n  created_by(Work, Artist)\n  year_created(Work, Y)\n  Y < 1970\n" in
  Alcotest.(check (list string)) "rows" [ "artist_1,work_3" ] (rows r)

let first_error r = r |> member "errors" |> index 0 |> member "code" |> to_string

let test_invalid () =
  let r = Beingdb_wasm.query "find W\nwhere\n  created_bi(W, A)\n" in
  Alcotest.(check bool) "invalid" false (r |> member "valid" |> to_bool);
  Alcotest.(check string) "unknown predicate" "unknown_predicate" (first_error r);
  Alcotest.(check string) "suggestion" "created_by"
    (r |> member "errors" |> index 0 |> member "suggestions" |> index 0 |> to_string);
  let r = Beingdb_wasm.query "find W where created_by(W, A)" in
  Alcotest.(check string) "syntax error" "syntax_error" (first_error r);
  let r = Beingdb_wasm.query "find W\nwhere\n  year_created(W, Y)\n  Y >= @1970-01-01\n" in
  Alcotest.(check string) "type mismatch" "comparison_type_mismatch" (first_error r)

(* A store whose created_by carries an author declaration, read through the
   same Session the browser uses. *)
let declared_session () =
  let open Beingdb_runtime in
  let declaration =
    Result.get_ok
      (Predicate_declaration.make
         ~arguments:(Some [ { role = "Work"; semantic_type = None }; { role = "Artist"; semantic_type = Some "person" } ])
         ~description:(Some "Relates a work to the artist who made it."))
  in
  let store = Memory_store.create () in
  Memory_store.add_predicate ~declaration store "created_by"
    [ Fact.make "created_by" [ Value.Atom "work_1"; Value.Atom "artist_1" ] ];
  Memory_store.add_predicate store "person" [ Fact.make "person" [ Value.Atom "artist_1" ] ];
  Beingdb_wasm.Fixture_session.open_store store

let predicate json name =
  json |> member "predicates" |> to_list |> List.find (fun p -> p |> member "name" |> to_string = name)

let test_declared_metadata () =
  let s = declared_session () in
  let json = Beingdb_wasm.Fixture_session.predicates s in
  let p = predicate json "created_by" in
  Alcotest.(check string) "description" "Relates a work to the artist who made it." (p |> member "description" |> to_string);
  let args = p |> member "arguments" |> to_list in
  Alcotest.(check (list string)) "roles" [ "Work"; "Artist" ] (List.map (fun a -> a |> member "role" |> to_string) args);
  Alcotest.(check (list (option string))) "semantic types" [ None; Some "person" ]
    (List.map (fun a -> a |> member "semanticType" |> to_string_option) args);
  (* Pre-existing metadata is still there. *)
  Alcotest.(check int) "arity" 2 (p |> member "arity" |> to_int);
  Alcotest.(check int) "count" 1 (p |> member "count" |> to_int);
  Alcotest.(check (list int)) "positions" [ 0; 1 ] (List.map (fun a -> a |> member "position" |> to_int) args);
  Alcotest.(check (list (list string))) "types" [ [ "atom" ]; [ "atom" ] ]
    (List.map (fun a -> a |> member "types" |> to_list |> List.map to_string) args);
  Alcotest.(check string) "example" "artist_1" (p |> member "examples" |> index 0 |> index 1 |> member "value" |> to_string);
  Alcotest.(check bool) "fingerprint" true (String.starts_with ~prefix:"sha256:" (json |> member "environmentFingerprint" |> to_string));
  Alcotest.(check string) "language version" "beingdb-dsl/1" (json |> member "languageVersion" |> to_string);
  (* Undeclared predicates simply omit the optional fields. *)
  let q = predicate json "person" in
  Alcotest.(check bool) "no description" true (q |> member "description" = `Null);
  Alcotest.(check bool) "no role" true (q |> member "arguments" |> index 0 |> member "role" = `Null);
  (* Declarations are descriptive only: queries run as before. *)
  let r = Beingdb_wasm.Fixture_session.query s "find Work, Artist\nwhere\n  created_by(Work, Artist)\n  person(Artist)\n" in
  Alcotest.(check (list string)) "query rows" [ "work_1,artist_1" ] (rows r)

let () =
  Alcotest.run "beingdb-wasm (native)"
    [
      ( "query",
        [
          Alcotest.test_case "join + range" `Quick test_join_and_range;
          Alcotest.test_case "three-way join" `Quick test_three_way_join;
          Alcotest.test_case "invalid queries" `Quick test_invalid;
        ] );
      ("predicates", [ Alcotest.test_case "declared metadata" `Quick test_declared_metadata ]);
    ]
