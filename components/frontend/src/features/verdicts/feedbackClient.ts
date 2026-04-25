import api from "../../lib/apiClient";

export async function dismissVerdict(verdictId: string): Promise<void> {
  await api.post(`/verdicts/${verdictId}/dismiss`);
}

export async function sendFeedback(
  verdictId: string,
  feedback: "helpful" | "wrong" | "unclear",
): Promise<void> {
  await api.post(`/verdicts/${verdictId}/feedback`, { feedback });
}
