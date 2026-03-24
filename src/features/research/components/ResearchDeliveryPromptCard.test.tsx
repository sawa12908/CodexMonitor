// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESEARCH_DELIVERY_PROMPT_PRESETS,
  ResearchDeliveryPromptCard,
} from "./ResearchDeliveryPromptCard";

afterEach(() => {
  cleanup();
});

describe("ResearchDeliveryPromptCard", () => {
  it("renders all preset switch buttons", () => {
    render(<ResearchDeliveryPromptCard value="" onChange={vi.fn()} />);

    for (const preset of RESEARCH_DELIVERY_PROMPT_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeTruthy();
    }
  });

  it("writes the selected preset into the prompt textarea", () => {
    const onChange = vi.fn();

    render(<ResearchDeliveryPromptCard value="" onChange={onChange} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: RESEARCH_DELIVERY_PROMPT_PRESETS[1].label,
      }),
    );

    expect(onChange).toHaveBeenCalledWith(
      RESEARCH_DELIVERY_PROMPT_PRESETS[1].content,
    );
  });

  it("marks the matching preset as active", () => {
    render(
      <ResearchDeliveryPromptCard
        value={RESEARCH_DELIVERY_PROMPT_PRESETS[3].content}
        onChange={vi.fn()}
      />,
    );

    const activeButton = screen.getByRole("button", {
      name: RESEARCH_DELIVERY_PROMPT_PRESETS[3].label,
    });

    expect(activeButton.getAttribute("aria-pressed")).toBe("true");
  });
});
