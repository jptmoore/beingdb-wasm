open Js_of_ocaml

let query text = Js.string (Beingdb_wasm.query_string (Js.to_string text))
let load text = Js.string (Yojson.Safe.to_string (Beingdb_wasm.load (Js.to_string text)))
let predicates () = Js.string (Yojson.Safe.to_string (Beingdb_wasm.predicates ()))
let diagnose text = Js.string (Yojson.Safe.to_string (Beingdb_wasm.diagnose (Js.to_string text)))
let validate text = Js.string (Yojson.Safe.to_string (Beingdb_wasm.validate (Js.to_string text)))
let explain text = Js.string (Yojson.Safe.to_string (Beingdb_wasm.explain (Js.to_string text)))

(* An optional integer argument: absent (undefined or null) is [None]; any
   other non-integer becomes 0, which the range check rejects. *)
let int_arg (x : Js.Unsafe.any) =
  match Js.to_string (Js.typeof x) with
  | "undefined" -> None
  | _ when Js.Unsafe.equals x Js.null -> None
  | "number" ->
      let f = Js.float_of_number (Js.Unsafe.coerce x) in
      Some (if Float.is_integer f && Float.abs f < 1e9 then int_of_float f else 0)
  | _ -> Some 0

let resolve text candidates =
  Js.string (Yojson.Safe.to_string (Beingdb_wasm.resolve ?candidates:(int_arg candidates) (Js.to_string text)))

let about value limit = Js.string (Yojson.Safe.to_string (Beingdb_wasm.about ?limit:(int_arg limit) (Js.to_string value)))

let () =
  let api =
    Js.Unsafe.obj
      [|
        ("query", Js.Unsafe.inject (Js.wrap_callback query));
        ("load", Js.Unsafe.inject (Js.wrap_callback load));
        ("predicates", Js.Unsafe.inject (Js.wrap_callback predicates));
        ("diagnose", Js.Unsafe.inject (Js.wrap_callback diagnose));
        ("validate", Js.Unsafe.inject (Js.wrap_callback validate));
        ("explain", Js.Unsafe.inject (Js.wrap_callback explain));
        ("resolve", Js.Unsafe.inject (Js.wrap_callback resolve));
        ("about", Js.Unsafe.inject (Js.wrap_callback about));
      |]
  in
  Js.Unsafe.set Js.Unsafe.global "BeingDB" api;
  (* The WASM module instantiates asynchronously; tell the page when ready. *)
  let ready = Js.Unsafe.get Js.Unsafe.global "onBeingDBReady" in
  if Js.typeof ready = Js.string "function" then ignore (Js.Unsafe.fun_call ready [| Js.Unsafe.inject api |])
