open Js_of_ocaml

let query text = Js.string (Beingdb_wasm.query_string (Js.to_string text))

let () =
  let api = Js.Unsafe.obj [| ("query", Js.Unsafe.inject (Js.wrap_callback query)) |] in
  Js.Unsafe.set Js.Unsafe.global "BeingDB" api;
  (* The WASM module instantiates asynchronously; tell the page when ready. *)
  let ready = Js.Unsafe.get Js.Unsafe.global "onBeingDBReady" in
  if Js.typeof ready = Js.string "function" then ignore (Js.Unsafe.fun_call ready [| Js.Unsafe.inject api |])
