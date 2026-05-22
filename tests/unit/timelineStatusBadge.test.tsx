import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineStatusBadge } from "../../client/src/components/TimelineStatusBadge";

describe("TimelineStatusBadge", () => {
  it('renders "可用" for available status', () => {
    render(<TimelineStatusBadge status="available" />);
    expect(screen.getByText("可用")).toBeInTheDocument();
  });

  it('renders "同日" for unavailable-same-day status', () => {
    render(<TimelineStatusBadge status="unavailable-same-day" />);
    expect(screen.getByText("同日")).toBeInTheDocument();
  });

  it('renders "晚于申请" for unavailable-later status', () => {
    render(<TimelineStatusBadge status="unavailable-later" />);
    expect(screen.getByText("晚于申请")).toBeInTheDocument();
  });

  it('renders "缺公开日" for needs-publication-date status', () => {
    render(<TimelineStatusBadge status="needs-publication-date" />);
    expect(screen.getByText("缺公开日")).toBeInTheDocument();
  });

  it('renders "缺基准日" for needs-baseline-date status', () => {
    render(<TimelineStatusBadge status="needs-baseline-date" />);
    expect(screen.getByText("缺基准日")).toBeInTheDocument();
  });

  it("renders fallback for undefined status (bug fix)", () => {
    // Bug 41: 当 status 为 undefined 时，组件不应该崩溃
    render(<TimelineStatusBadge status={undefined} />);
    expect(screen.getByText("未知")).toBeInTheDocument();
  });

  it("applies custom dataTestId", () => {
    render(<TimelineStatusBadge status="available" dataTestId="custom-test-id" />);
    expect(screen.getByTestId("custom-test-id")).toBeInTheDocument();
  });

  it("has correct title attribute for tooltip", () => {
    const { container } = render(<TimelineStatusBadge status="available" />);
    const badge = container.querySelector(".timeline-status-badge");
    expect(badge).toHaveAttribute("title", "公开日早于基准日，文献可用作对比文件");
  });

  it("has correct title attribute for undefined status", () => {
    const { container } = render(<TimelineStatusBadge status={undefined} />);
    const badge = container.querySelector(".timeline-status-badge");
    expect(badge).toHaveAttribute("title", "时间轴状态未知");
  });
});