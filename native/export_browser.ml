(* beingdb export-browser: write the logical view of a compiled pack as JSON. *)

let () =
  match Sys.argv with
  | [| _; "--pack"; pack; "-o"; out |] ->
      Lwt_main.run
        (Pack_export.with_pack pack (fun store ->
             Lwt.map (fun json -> Yojson.Safe.to_file out json) (Pack_export.export store)))
  | _ ->
      prerr_endline "usage: export_browser --pack DIR -o FILE";
      exit 2
