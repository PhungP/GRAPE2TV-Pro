import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Boundary } from "./Boundary";
import { bridge } from "./native";

// Lỗi JS chưa bắt: ghi vào nhật ký chẩn đoán của Android (giới hạn tần suất ở phía Android)
const report = (m: string) => { try { bridge()?.reportError(m.slice(0, 240), false); } catch { /* bỏ qua */ } };
window.addEventListener("error", (e) => report(`error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => report(`promise: ${String((e.reason && (e.reason.message || e.reason)) || "?")}`));

try {
  createRoot(document.getElementById("root")!).render(<Boundary name="root" fatal><App /></Boundary>);
} catch (e) {
  bridge()?.reportError(`mount: ${String(e)}`, true);   // Android sẽ phục hồi có giới hạn thay vì để màn hình đen
}
