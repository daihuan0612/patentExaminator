import { useState } from "react";
import { useDefectsStore } from "../../store";
import type { DefectRequest, DefectResponse } from "../../agent/contracts";
import type { FormalDefect } from "@shared/types/domain";
import { InlineEdit } from "../../components/InlineEdit";
import { ConfirmModal } from "../../components/ConfirmModal";

interface DefectPanelProps {
  caseId: string;
  claimText: string;
  specificationText: string;
  claimFeatures: Array<{ featureCode: string; description: string }>;
  runDefectCheck: (request: DefectRequest) => Promise<DefectResponse>;
}

const SEVERITY_LABELS: Record<string, string> = {
  error: "严重",
  warning: "警告",
  info: "提示"
};

const OVERCOME_LABELS: Record<string, string> = {
  overcome: "已克服",
  "not-overcome": "未克服",
  "partially-overcome": "部分克服"
};

export function DefectPanel({
  caseId,
  claimText,
  specificationText,
  claimFeatures,
  runDefectCheck
}: DefectPanelProps) {
  const { defects, addDefect, updateDefect, removeDefect, isLoading, setLoading } =
    useDefectsStore();
  const [showConfirm, setShowConfirm] = useState(false);

  const caseDefects = defects.filter((d) => d.caseId === caseId);
  const unresolvedCount = caseDefects.filter((d) => !d.resolved).length;

  const handleRun = async () => {
    if (isLoading) return;
    // 如果已有缺陷，显示确认对话框
    if (caseDefects.length > 0 && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    setLoading(true);
    try {
      const request: DefectRequest = {
        caseId,
        claimText,
        specificationText,
        claimFeatures
      };

      const response = await runDefectCheck(request);

      // === 缺陷保留策略 ===
      // 1. 用户手动添加的缺陷（ID 格式为 3 部分）：全部保留
      // 2. 用户编辑过的 AI 缺陷（ID 格式为 4 部分）：保留 编辑过的字段
      // 
      // 判断"已编辑"的标准：
      // - severity 被修改（通过比较原始 AI 返回值）
      // - description 被修改（通过比较原始 AI 返回值）
      // - location 被添加或修改
      // - resolved 状态被修改（从未解决变为已解决）
      //
      // 对于编辑过的 AI 缺陷，将用户编辑的字段 merge 到新返回的匹配缺陷上

      // 用户添加的缺陷 ID 格式: defect-{caseId}-{timestamp} (无随机后缀，3部分)
      // AI 生成的缺陷 ID 格式: defect-{caseId}-{timestamp}-{random} (有随机后缀，4部分)
      const userAddedDefects = caseDefects.filter((d) => {
        const parts = d.id.split("-");
        return parts.length === 3;
      });

      // AI 生成的缺陷
      const aiGeneratedDefects = caseDefects.filter((d) => {
        const parts = d.id.split("-");
        return parts.length === 4;
      });

      // 为 AI 返回的新缺陷创建映射（用于匹配和 merge）
      // 使用 category + description 前 30 字符作为匹配键
      const aiResponseMap = new Map<string, typeof response.defects[0]>();
      for (const item of response.defects) {
        const key = `${item.category}|${item.description.trim().slice(0, 30)}`;
        aiResponseMap.set(key, item);
      }

      // 找出用户编辑过的 AI 缺陷
      const editedAiDefects: FormalDefect[] = [];
      for (const d of aiGeneratedDefects) {
        const key = `${d.category}|${d.description.trim().slice(0, 30)}`;
        const aiItem = aiResponseMap.get(key);
        
        if (aiItem) {
          // 找到匹配的 AI 返回项，检查是否有编辑
          const hasEdited = 
            d.severity !== aiItem.severity ||
            d.description !== aiItem.description ||
            d.resolved === true ||  // 用户标记为已解决
            d.location;  // 用户添加了 location
          
          if (hasEdited) {
            editedAiDefects.push(d);
          }
        } else {
          // 未找到匹配项，说明用户完全重写了 description，保留这个缺陷
          editedAiDefects.push(d);
        }
      }

      console.log("[DefectPanel] handleRun - defect preservation:", {
        total: caseDefects.length,
        userAdded: userAddedDefects.length,
        aiGenerated: aiGeneratedDefects.length,
        editedAi: editedAiDefects.length,
        aiResponseCount: response.defects.length
      });

      // 清除所有旧缺陷
      const oldIds = caseDefects.map((d) => d.id);
      for (const id of oldIds) {
        useDefectsStore.getState().removeDefect(id);
      }

      // 添加 AI 新返回的缺陷，并 merge 用户编辑过的字段
      for (const item of response.defects) {
        const key = `${item.category}|${item.description.trim().slice(0, 30)}`;
        
        // 查找是否有匹配的用户编辑过的缺陷
        const editedMatch = editedAiDefects.find(d => 
          `${d.category}|${d.description.trim().slice(0, 30)}` === key
        );

        const defect: FormalDefect = {
          id: `defect-${caseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          caseId,
          category: editedMatch?.category ?? item.category,
          description: editedMatch?.description ?? item.description,
          severity: editedMatch?.severity ?? item.severity,
          resolved: editedMatch?.resolved ?? false,
          ...(editedMatch?.location ? { location: editedMatch.location } : 
              item.location ? { location: item.location } : {}),
          ...(item.previouslyRaised !== undefined ? { previouslyRaised: item.previouslyRaised } : {}),
          ...(item.overcomeStatus ? { overcomeStatus: item.overcomeStatus } : {})
        };
        
        if (editedMatch) {
          console.log("[DefectPanel] merged edited defect:", {
            originalKey: key,
            newDefectId: defect.id,
            mergedFields: {
              severity: editedMatch.severity,
              resolved: editedMatch.resolved,
              location: editedMatch.location
            }
          });
        }
        
        addDefect(defect);
      }

      // 重新添加用户手动添加的缺陷（保留用户的手动编辑）
      for (const userDefect of userAddedDefects) {
        console.log("[DefectPanel] restoring user-added defect:", userDefect.id);
        addDefect(userDefect);
      }

      // 重新添加未匹配到的编辑过的 AI 缺陷（用户完全重写的）
      for (const editedDefect of editedAiDefects) {
        const key = `${editedDefect.category}|${editedDefect.description.trim().slice(0, 30)}`;
        if (!aiResponseMap.has(key)) {
          console.log("[DefectPanel] restoring unmatched edited defect:", editedDefect.id);
          addDefect(editedDefect);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleResolved = (defect: FormalDefect) => {
    updateDefect({ ...defect, resolved: !defect.resolved });
  };

  const handleDeleteDefect = (id: string) => {
    removeDefect(id);
  };

  const handleAddDefect = () => {
    const newDefect: FormalDefect = {
      id: `defect-${caseId}-${Date.now()}`,
      caseId,
      category: "权利要求",
      description: "",
      severity: "warning",
      resolved: false
    };
    addDefect(newDefect);
  };

  // Group defects by category
  const grouped = new Map<string, FormalDefect[]>();
  for (const d of caseDefects) {
    const list = grouped.get(d.category) ?? [];
    list.push(d);
    grouped.set(d.category, list);
  }

  return (
    <div className="defect-panel" data-testid="defect-panel">
      <h2>缺陷复查</h2>

      {caseDefects.length > 0 && (
        <div className="defect-legal-caution" data-testid="defect-legal-caution">
          以下为 AI 辅助检测结果，需审查员逐项确认。
        </div>
      )}

      {caseDefects.length > 0 ? (
        <div className="defect-result">
          <div className="defect-summary" data-testid="defect-summary">
            共 {caseDefects.length} 项缺陷，其中 {unresolvedCount} 项未解决
          </div>

          {[...grouped.entries()].map(([category, items]) => (
            <div key={category} className="defect-category-group">
              <h3 className="defect-category-title">{category}</h3>
              <table className="defect-table" data-testid="defect-table">
                <thead>
                  <tr>
                    <th className="defect-col-severity">严重度</th>
                    <th className="defect-col-desc">缺陷描述</th>
                    <th className="defect-col-location">位置</th>
                    <th>上次已指出</th>
                    <th>克服状态</th>
                    <th className="defect-col-status">状态</th>
                    <th className="defect-col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => (
                    <tr
                      key={d.id}
                      className={d.resolved ? "defect-row--resolved" : ""}
                      data-testid={`defect-row-${d.id}`}
                    >
                      <td>
                        <InlineEdit
                          as="select"
                          value={d.severity}
                          options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))}
                          onSave={(v) => updateDefect({ ...d, severity: v as FormalDefect["severity"] })}
                        >
                          <span
                            className={`severity-badge severity-${d.severity}`}
                            data-testid={`severity-${d.id}`}
                          >
                            {SEVERITY_LABELS[d.severity]}
                          </span>
                        </InlineEdit>
                      </td>
                      <td className="defect-desc">
                        <InlineEdit
                          as="textarea"
                          value={d.description}
                          rows={2}
                          onSave={(v) => updateDefect({ ...d, description: v })}
                        >
                          <span>{d.description}</span>
                        </InlineEdit>
                      </td>
                      <td className="defect-location">
                        <InlineEdit
                          value={d.location ?? ""}
                          placeholder="无"
                          onSave={(v) => {
                            const patch: Partial<FormalDefect> = v ? { location: v } : {};
                            if (!v) delete patch.location;
                            updateDefect({ ...d, ...patch });
                          }}
                        >
                          <span>{d.location || "—"}</span>
                        </InlineEdit>
                      </td>
                      <td>{d.previouslyRaised ? "是" : "否"}</td>
                      <td>{d.overcomeStatus ? OVERCOME_LABELS[d.overcomeStatus] : "—"}</td>
                      <td>
                        <label className="defect-resolve-toggle">
                          <input
                            type="checkbox"
                            checked={d.resolved}
                            onChange={() => handleToggleResolved(d)}
                            data-testid={`resolve-${d.id}`}
                          />
                          {d.resolved ? "已解决" : "未解决"}
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-delete-icon"
                          onClick={() => handleDeleteDefect(d.id)}
                          data-testid={`delete-defect-${d.id}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="btn-add-item"
                onClick={handleAddDefect}
                data-testid="add-defect"
                style={{ marginTop: 8 }}
              >
                + 添加缺陷
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="defect-empty" data-testid="defect-empty">
          <p>尚未运行缺陷复查。</p>
          <p className="defect-empty-hint">点击下方按钮，AI 将自动检测本轮修改是否克服上次指出的形式缺陷。</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleRun}
        disabled={isLoading}
        data-testid="btn-run-defect-check"
      >
        {isLoading ? "检测中..." : caseDefects.length > 0 ? "重新运行复查" : "运行缺陷复查"}
      </button>

      <ConfirmModal
        isOpen={showConfirm}
        title="确认重新运行复查"
        confirmLabel="确认重新运行"
        cancelLabel="取消"
        onConfirm={handleRun}
        onCancel={() => setShowConfirm(false)}
      >
        重新运行将用 AI 新检测结果替换所有缺陷。您手动添加的缺陷和已编辑修改的缺陷将被保留。确定要继续吗？
      </ConfirmModal>
    </div>
  );
}
