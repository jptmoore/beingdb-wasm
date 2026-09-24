(* Pack_layout.READER over an exported logical pack view: a JSON tree in
   which an object is a directory (children in the native [list] order) and a
   string is the contents stored at that path. See README "Browser export". *)

type node = Contents of string | Dir of { children : string list; table : (string, node) Hashtbl.t }
type t = node

let format = "beingdb-logical-pack-view"
let format_version = 0

let rec node_of_json : Yojson.Safe.t -> node = function
  | `String s -> Contents s
  | `Assoc kvs ->
      let table = Hashtbl.create (List.length kvs) in
      List.iter (fun (k, v) -> Hashtbl.replace table k (node_of_json v)) kvs;
      Dir { children = List.map fst kvs; table }
  | _ -> failwith "export tree nodes must be objects or strings"

let of_json json =
  let open Yojson.Safe.Util in
  if member "format" json <> `String format then Error "not a beingdb-logical-pack-view export"
  else if member "formatVersion" json <> `Int format_version then Error "unsupported export formatVersion"
  else match node_of_json (member "tree" json) with node -> Ok node | exception Failure msg -> Error msg

let of_string s = match Yojson.Safe.from_string s with json -> of_json json | exception Yojson.Json_error msg -> Error msg

let rec lookup node path =
  match (node, path) with
  | _, [] -> Some node
  | Dir { table; _ }, step :: rest -> Option.bind (Hashtbl.find_opt table step) (fun child -> lookup child rest)
  | Contents _, _ :: _ -> None

let find t path = Lwt.return (match lookup t path with Some (Contents s) -> Some s | _ -> None)
let list t path = Lwt.return (match lookup t path with Some (Dir { children; _ }) -> children | _ -> [])

let rec entry_count = function Contents _ -> 1 | Dir { table; _ } -> Hashtbl.fold (fun _ n acc -> acc + entry_count n) table 0
