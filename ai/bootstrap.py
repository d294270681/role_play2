"""启动项目内 ComfyUI，运行环境不读取用户级 Python 包或源安装目录。"""
import importlib
import importlib.metadata
import json
from pathlib import Path
import runpy
import sys

AI_ROOT = Path(__file__).resolve().parent
COMFY_ROOT = AI_ROOT / "vendor" / "ComfyUI"
sys.path.insert(0, str(COMFY_ROOT))

if "--check" in sys.argv:
    names = ["torch", "torchvision", "numpy", "PIL", "transformers", "aiohttp", "safetensors", "yaml", "comfyui_frontend_package"]
    locations = {}
    for name in names:
        module = importlib.import_module(name)
        filename = Path(module.__file__).resolve()
        if not filename.is_relative_to(AI_ROOT):
            raise RuntimeError(f"依赖 {name} 来自项目外部：{filename}")
        locations[name] = str(filename.relative_to(AI_ROOT))
    import torch
    packages = sorted({f"{d.metadata['Name']}=={d.version}" for d in importlib.metadata.distributions() if d.metadata.get("Name")})
    print(json.dumps({
        "python": sys.version.split()[0], "prefix": sys.prefix,
        "torch": torch.__version__, "cuda": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "dependencies": locations, "packages": packages,
    }, ensure_ascii=False))
else:
    sys.argv[0] = str(COMFY_ROOT / "main.py")
    runpy.run_path(sys.argv[0], run_name="__main__")
