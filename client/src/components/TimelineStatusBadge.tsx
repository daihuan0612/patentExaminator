import type { TimelineStatus } from "@shared/types/domain";

interface TimelineStatusBadgeProps {
  status: TimelineStatus | undefined;
  dataTestId?: string;
}

// 默认配置，用于无效 status 的 fallback
const DEFAULT_CONFIG = {
  label: "未知",
  color: "#757575",
  bg: "#f5f5f5",
  tip: "时间轴状态未知"
} as const;

const STATUS_CONFIG: Record<TimelineStatus, { label: string; color: string; bg: string; tip: string }> = {
  available: {
    label: "可用",
    color: "#2e7d32",
    bg: "#e8f5e9",
    tip: "公开日早于基准日，文献可用作对比文件"
  },
  "unavailable-same-day": {
    label: "同日",
    color: "#f57f17",
    bg: "#fff8e1",
    tip: "公开日与基准日相同，不可用作对比文件（专利法第22条）"
  },
  "unavailable-later": {
    label: "晚于申请",
    color: "#c62828",
    bg: "#ffebee",
    tip: "公开日晚于基准日，不可用作对比文件"
  },
  "needs-publication-date": {
    label: "缺公开日",
    color: "#757575",
    bg: "#f5f5f5",
    tip: "缺少公开日信息，无法进行时间轴校验"
  },
  "needs-baseline-date": {
    label: "缺基准日",
    color: "#757575",
    bg: "#f5f5f5",
    tip: "缺少申请日/优先权日，无法进行时间轴校验"
  }
};

export function TimelineStatusBadge({ status, dataTestId }: TimelineStatusBadgeProps) {
  // 防御性编程：当 status 无效时使用默认配置
  const config = status ? STATUS_CONFIG[status] : DEFAULT_CONFIG;

  return (
    <span
      className="timeline-status-badge"
      data-testid={dataTestId ?? `badge-timeline-${status ?? "unknown"}`}
      title={config.tip}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: 500,
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.color}`
      }}
    >
      {config.label}
    </span>
  );
}
