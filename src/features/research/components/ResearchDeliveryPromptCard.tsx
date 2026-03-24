type ResearchDeliveryPromptCardProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

const DELIVERY_PROMPT_PLACEHOLDER =
  "\u4f8b\u5982\uff1a\u8bf7\u5206\u6790\u672c\u8f6e\u7ed3\u679c\uff0c\u5e76\u5f00\u59cb\u4e0b\u4e00\u8f6e\u7814\u7a76\u3002";

type ResearchDeliveryPromptPreset = {
  id: string;
  label: string;
  content: string;
};

export const RESEARCH_DELIVERY_PROMPT_PRESETS: ResearchDeliveryPromptPreset[] = [
  {
    id: "summary-only",
    label: "\u4ec5\u56de\u5199\u603b\u7ed3",
    content: `请根据本轮主要产物路径中的 ml_eval_manifest.json 自动识别 snapshot_date，并使用 --manifest-path 定向回写本轮总结：调用 python qlib_lab/scripts/summarize_ml_strategy_table.py --snapshot-date <识别出的日期> --manifest-path <本轮ml_eval_manifest.json绝对路径> --ai-summary "<你对本轮结果的简短总结>" 更新策略总表。

更新后不要只信脚本返回值，必须继续执行：
python qlib_lab/scripts/ml_round_ops.py verify-summary --manifest-path <本轮ml_eval_manifest.json绝对路径>

只有 verify-summary 通过，才算本轮总表更新完成。回复时必须明确说明本轮 snapshot_date、summarize_ml_strategy_table.py 的返回结果、verify-summary 是否通过，以及总表 CSV 中本轮对应 round_label 的 ai_summary 已正确写入且没有覆盖其他轮；同时确认本轮 ml_eval_manifest.json 顶层 ai_summary 和 summary_refresh.ai_summary 已同步写入。

如果 summarize_ml_strategy_table.py 返回 fallback_pending_reconcile，必须明确说明主 CSV 当时未成功写入、当前结果只写入了 fallback/reconcile 记录，不能表述成主表已更新成功。`,
  },
  {
    id: "summary-and-refill",
    label: "\u56de\u5199\u5e76\u8865\u6ee1\u5e76\u884c",
    content: `请根据本轮主要产物路径中的 ml_eval_manifest.json 自动识别 snapshot_date，并使用 --manifest-path 定向回写本轮总结：调用 python qlib_lab/scripts/summarize_ml_strategy_table.py --snapshot-date <识别出的日期> --manifest-path <本轮ml_eval_manifest.json绝对路径> --ai-summary "<你对本轮结果的简短总结>" 更新策略总表。

更新后不要只信脚本返回值，必须继续执行：
python qlib_lab/scripts/ml_round_ops.py verify-summary --manifest-path <本轮ml_eval_manifest.json绝对路径>

只有 verify-summary 通过，才算本轮总表更新完成。回复时必须明确说明本轮 snapshot_date、summarize_ml_strategy_table.py 的返回结果、verify-summary 是否通过，以及总表 CSV 中本轮对应 round_label 的 ai_summary 已正确写入且没有覆盖其他轮；同时确认本轮 ml_eval_manifest.json 顶层 ai_summary 和 summary_refresh.ai_summary 已同步写入。

如果 summarize_ml_strategy_table.py 返回 fallback_pending_reconcile，必须明确说明主 CSV 当时未成功写入、当前结果只写入了 fallback/reconcile 记录，不能表述成主表已更新成功。

然后继续大胆探索策略。你不需要根据上一轮结果提出下一轮策略，可以自由提出完全不同方向，因为现在仍在粗探索阶段。继续前先执行：
python qlib_lab/scripts/ml_round_ops.py count-running

只有当 running evaluate 数量小于 3 时才补到 3 个，并在回复里明确说明当前 running 数量、已有任务、以及新补开的任务。`,
  },
  {
    id: "verify-only",
    label: "\u53ea\u6838\u5bf9\u4e0d\u7ee7\u7eed",
    content: `请根据本轮主要产物路径中的 ml_eval_manifest.json 自动识别 snapshot_date，并使用 --manifest-path 定向回写本轮总结：调用 python qlib_lab/scripts/summarize_ml_strategy_table.py --snapshot-date <识别出的日期> --manifest-path <本轮ml_eval_manifest.json绝对路径> --ai-summary "<你对本轮结果的简短总结>" 更新策略总表。

更新后不要只信脚本返回值，必须继续执行：
python qlib_lab/scripts/ml_round_ops.py verify-summary --manifest-path <本轮ml_eval_manifest.json绝对路径>

回复时只汇报核对结果：本轮 snapshot_date、summarize_ml_strategy_table.py 返回结果、verify-summary 是否通过、CSV 中本轮 ai_summary 是否正确写入且未覆盖其他轮、manifest 顶层 ai_summary 和 summary_refresh.ai_summary 是否同步写入。不要启动新的 evaluate。`,
  },
  {
    id: "stop-next-round",
    label: "\u505c\u6b62\u4e0b\u4e00\u8f6e",
    content: `请根据本轮主要产物路径中的 ml_eval_manifest.json 自动识别 snapshot_date，并使用 --manifest-path 定向回写本轮总结：调用 python qlib_lab/scripts/summarize_ml_strategy_table.py --snapshot-date <识别出的日期> --manifest-path <本轮ml_eval_manifest.json绝对路径> --ai-summary "<你对本轮结果的简短总结>" 更新策略总表。

更新后不要只信脚本返回值，必须继续执行：
python qlib_lab/scripts/ml_round_ops.py verify-summary --manifest-path <本轮ml_eval_manifest.json绝对路径>

只有 verify-summary 通过，才算本轮总表更新完成。回复时必须明确说明本轮 snapshot_date、summarize_ml_strategy_table.py 的返回结果、verify-summary 是否通过，以及总表 CSV 中本轮对应 round_label 的 ai_summary 已正确写入且没有覆盖其他轮；同时确认本轮 ml_eval_manifest.json 顶层 ai_summary 和 summary_refresh.ai_summary 已同步写入。

如果 summarize_ml_strategy_table.py 返回 fallback_pending_reconcile，必须明确说明主 CSV 当时未成功写入、当前结果只写入了 fallback/reconcile 记录，不能表述成主表已更新成功。

完成后停止下一轮，不要启动任何新的 evaluate。`,
  },
];

function normalizePresetValue(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export function ResearchDeliveryPromptCard({
  value,
  onChange,
  className,
}: ResearchDeliveryPromptCardProps) {
  const normalizedValue = normalizePresetValue(value);
  const sectionClassName = [
    "research-panel-section",
    "research-delivery-prompt-card",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={sectionClassName}>
      <div className="research-panel-section-header">
        <h4>Auto follow-up</h4>
      </div>
      <p className="research-panel-empty-copy">
        Saved automatically for this workspace and appended to completed research run
        auto-replies.
      </p>
      <div
        className="research-delivery-prompt-presets"
        role="group"
        aria-label="Follow-up prompt templates"
      >
        {RESEARCH_DELIVERY_PROMPT_PRESETS.map((preset) => {
          const isActive = normalizePresetValue(preset.content) === normalizedValue;
          return (
            <button
              key={preset.id}
              type="button"
              className={`research-delivery-prompt-preset-button${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
              onClick={() => {
                onChange(preset.content);
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <textarea
        className="research-panel-textarea research-delivery-prompt-textarea"
        rows={14}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={DELIVERY_PROMPT_PLACEHOLDER}
      />
    </section>
  );
}
