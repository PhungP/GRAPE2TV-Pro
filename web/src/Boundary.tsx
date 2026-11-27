import React from "react";
import { bridge } from "./native";

type Props = { name: string; children: React.ReactNode; fatal?: boolean; silent?: boolean };

/**
 * Chặn lỗi render để một component hỏng không làm cả launcher thành màn hình đen.
 * - silent: chỉ ẩn phần hỏng (vd. thẻ thời tiết), phần còn lại vẫn chạy.
 * - fatal: lỗi ở gốc → hiện màn hình lỗi nhẹ và báo Android phục hồi (tải lại WebView, có giới hạn số lần).
 */
export class Boundary extends React.Component<Props, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: Error) { bridge()?.reportError(`${this.props.name}: ${e.message}`, !!this.props.fatal); }
  render() {
    if (!this.state.err) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#101014", color: "#f4f2f8", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
        <div>
          <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>GRAPE2TV Pro</p>
          <p style={{ margin: "10px 0 18px", color: "#9b98a5" }}>Giao diện gặp lỗi và đang được tải lại.</p>
          <button autoFocus onClick={() => (bridge() ? bridge()!.recover() : location.reload())}
            style={{ background: "#a078ed", color: "#0d0716", border: 0, borderRadius: 12, padding: "12px 22px", fontSize: 16, fontWeight: 700 }}>Tải lại ngay</button>
        </div>
      </div>
    );
  }
}
