You are evaluating whether a candidate answer is semantically equivalent to a reference answer for a knowledge-graph Q&A system.

Question: {{question}}

Reference answer (ground truth):
{{reference_answer}}

Candidate answer (from agent):
{{candidate_answer}}

Judge whether the candidate answer is semantically correct relative to the reference.
A candidate passes if it conveys the same key facts, even if phrased differently.
A candidate fails if it omits critical facts, states incorrect facts, or hallucinates information not in the reference.
Partial answers that cover most key facts but miss minor details should pass.

{{language_instruction}}

Respond with valid JSON matching this schema exactly:
{{output_schema}}
