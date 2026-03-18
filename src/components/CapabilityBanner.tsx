interface CapabilityBannerProps {
  level: "ok" | "warning" | "error";
  message?: string;
}

export function CapabilityBanner({ level, message }: CapabilityBannerProps) {
  if (level === "ok") return null;

  const icon = level === "warning" ? "⚠️" : "❌";
  const className = level === "warning" ? "banner-warning" : "banner-error";

  return (
    <div className={`banner ${className}`}>
      <span>{icon}</span>
      <span>{message ?? "Partial feature support — some code may not visualize correctly."}</span>
    </div>
  );
}
