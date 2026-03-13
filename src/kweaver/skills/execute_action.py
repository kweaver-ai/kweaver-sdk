"""Skill: execute an Action in a knowledge network."""

from __future__ import annotations

from typing import Any

from kweaver.skills._base import BaseSkill


class ExecuteActionSkill(BaseSkill):
    """Execute an Action Type in a knowledge network and optionally wait for result."""

    def _execute(
        self,
        *,
        kn_id: str | None = None,
        kn_name: str | None = None,
        action_type_id: str | None = None,
        action_name: str | None = None,
        params: dict[str, Any] | None = None,
        wait: bool = True,
        timeout: float = 300,
    ) -> dict[str, Any]:
        # Resolve kn_id from name if needed
        resolved_kn_id = kn_id
        if not resolved_kn_id and kn_name:
            kns = self.client.knowledge_networks.list(name=kn_name)
            if not kns:
                return {"error": True, "message": f"知识网络 '{kn_name}' 不存在"}
            resolved_kn_id = kns[0].id
        if not resolved_kn_id:
            return {"error": True, "message": "请提供 kn_id 或 kn_name"}

        # Resolve action_type_id from name if needed
        resolved_at_id = action_type_id
        if not resolved_at_id and action_name:
            # Use kn_search to find action types
            search_result = self.client.query.kn_search(resolved_kn_id, action_name)
            action_types = search_result.action_types or []
            for at in action_types:
                if at.get("name") == action_name:
                    resolved_at_id = at.get("id")
                    break
            if not resolved_at_id and action_types:
                resolved_at_id = action_types[0].get("id")
        if not resolved_at_id:
            return {"error": True, "message": "请提供 action_type_id 或 action_name"}

        # Execute the action
        execution = self.client.action_types.execute(
            resolved_kn_id, resolved_at_id, params=params
        )

        if not wait:
            return {
                "execution_id": execution.execution_id,
                "status": execution.status,
            }

        # Wait for completion
        try:
            result = execution.wait(timeout=timeout)
        except TimeoutError:
            return {
                "execution_id": execution.execution_id,
                "status": "timeout",
                "message": f"Action 执行超过 {timeout} 秒未完成",
            }

        return {
            "execution_id": result.execution_id,
            "status": result.status,
            "result": result.result,
        }
