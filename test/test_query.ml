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

let () =
  Alcotest.run "beingdb-wasm (native)"
    [
      ( "query",
        [
          Alcotest.test_case "join + range" `Quick test_join_and_range;
          Alcotest.test_case "three-way join" `Quick test_three_way_join;
          Alcotest.test_case "invalid queries" `Quick test_invalid;
        ] );
    ]
