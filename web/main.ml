open Js_of_ocaml

let query text = Js.string (Beingdb_wasm.query_string (Js.to_string text))
let load text = Js.string (Yojson.Safe.to_string (Beingdb_wasm.load (Js.to_string text)))
let predicates () = Js.string (Yojson.Safe.to_string (Beingdb_wasm.predicates ()))

let () =
  let api =
    Js.Unsafe.obj
      [|
        ("query", Js.Unsafe.inject (Js.wrap_callback query));
        ("load", Js.Unsafe.inject (Js.wrap_callback load));
        ("predicates", Js.Unsafe.inject (Js.wrap_callback predicates));
      |]
  in
  Js.Unsafe.set Js.Unsafe.global "BeingDB" api;
  (* The WASM module instantiates asynchronously; tell the page when ready. *)
  let ready = Js.Unsafe.get Js.Unsafe.global "onBeingDBReady" in
  if Js.typeof ready = Js.string "function" then ignore (Js.Unsafe.fun_call ready [| Js.Unsafe.inject api |])
