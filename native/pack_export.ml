(* Mechanical export of a compiled pack's logical key/value tree, read through
   the same Pack_backend.Reader (find/list) that the native runtime uses. *)

open Lwt.Syntax
module Pack_backend = Beingdb_pack_unix.Pack_backend
module Export_reader = Beingdb_wasm.Export_reader

let rec walk store path : Yojson.Safe.t Lwt.t =
  let* contents = Pack_backend.Reader.find store path in
  match contents with
  | Some s -> Lwt.return (`String s)
  | None ->
      let* children = Pack_backend.Reader.list store path in
      let+ kvs =
        Lwt_list.map_s
          (fun step ->
            let+ v = walk store (path @ [ step ]) in
            (step, v))
          children
      in
      `Assoc kvs

let export store =
  let+ tree = walk store [] in
  `Assoc [ ("format", `String Export_reader.format); ("formatVersion", `Int Export_reader.format_version); ("tree", tree) ]

let with_pack path f =
  let* store = Pack_backend.init ~readonly:true path in
  Lwt.finalize (fun () -> f store) (fun () -> Pack_backend.close_repo (Pack_backend.Store.repo store))
