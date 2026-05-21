export default function Loading() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "1rem",
      padding: "1rem", paddingBottom: "150px"
    }}>
      <div style={{ height: 28, width: "40%", borderRadius: 8, background: "rgba(255,255,255,0.07)", animation: "pulse 1.5s infinite" }} />
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: "1rem", alignItems: "center", padding: "0.6rem" }}>
          <div style={{ width: 52, height: 52, borderRadius: 10, background: "rgba(255,255,255,0.07)", flexShrink: 0, animation: "pulse 1.5s infinite" }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 13, width: "65%", borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 8, animation: "pulse 1.5s infinite" }} />
            <div style={{ height: 10, width: "40%", borderRadius: 6, background: "rgba(255,255,255,0.05)", animation: "pulse 1.5s infinite" }} />
          </div>
        </div>
      ))}
      <style>{`@keyframes pulse { 0%,100% { opacity:0.5 } 50% { opacity:1 } }`}</style>
    </div>
  );
}
