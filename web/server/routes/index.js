/**
 * /api 下的路由汇总（由 index.js 挂在 /api 前缀）。
 */

import { Router } from "express";

import modulesRouter from "./modules.js";
import gameRouter from "./game.js";
import configRouter from "./config.js";
import imageRouter from "./image.js";

const router = Router();

router.use(modulesRouter);
router.use(gameRouter);
router.use(configRouter);
router.use(imageRouter);

export default router;
