"""web.engine —— RPG 引擎纯逻辑层（骰子 / 存档状态 / RPG 本解析）。

纯标准库实现，不写 HTTP 代码；后端与前端通过 web/engine 的这几个模块调用。
"""

from . import dice, module_loader, state

__all__ = ["dice", "module_loader", "state"]
