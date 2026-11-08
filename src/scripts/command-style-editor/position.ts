/**
 * @file position.ts
 * @overview Previewable console placement using the same command engine as styles.
 */
import { CATALOG } from "./catalog";
import type { CommandStep, ConsolePosition, Dock } from "./model";

export const DEFAULT_POSITION: ConsolePosition = {dock:"top",x:0,y:56};
type Bounds = [width:number, height:number, viewportW:number, viewportH:number];
type Coordinates = {x:number; y:number};
/** Keep a movable console inside the visible window, including tiny popouts. */
export function clampPosition(x:number, y:number, ...[width,height,viewportW,viewportH]:Bounds): Coordinates {
  return {x:Math.max(0,Math.min(Math.max(0,viewportW-width),x)),y:Math.max(0,Math.min(Math.max(0,viewportH-height),y))};
}
/** Resolve raw dock coordinates, independently of bounds clamping. */
function rawDockPosition(pos:ConsolePosition, ...[width,height,viewportW,viewportH]:Bounds):Coordinates {
  const gap=16;
  const cx=(viewportW-width)/2;
  const cy=(viewportH-height)/2;
  switch (pos.dock) {
    case "top": return {x:cx,y:gap+Math.max(0,pos.y)};
    case "bottom": return {x:cx,y:viewportH-height-gap};
    case "left": return {x:gap,y:cy};
    case "right": return {x:viewportW-width-gap,y:cy};
    case "center": return {x:cx,y:cy};
    default: return {x:pos.x,y:pos.y};
  }
}
/** Calculate a dock position without storing viewport-dependent coordinates. */
export function dockPosition(pos:ConsolePosition, ...bounds:Bounds):Coordinates {
  const coords=rawDockPosition(pos,...bounds);
  return clampPosition(coords.x,coords.y,...bounds);
}
/** Apply an anchor change, cycling through supported dock presets. */
function changeDock(pos:ConsolePosition,step:CommandStep):ConsolePosition {
  const {operation,value}=step.binding;
  const choices=CATALOG.consoleDock.choices?.map((choice)=>choice.value) ?? [];
  const dock=operation==="cycle" ? choices[(choices.indexOf(pos.dock)+1)%choices.length] : value;
  return {...pos,dock:dock as Dock};
}
/** Resolve a coordinate change relative to the current effective location. */
function changeCoordinate(pos:ConsolePosition,step:CommandStep,bounds:Bounds):ConsolePosition {
  const current=dockPosition(pos,...bounds);
  const coordinate=step.binding.property==="consoleX" ? "x" : "y";
  const next={dock:"custom" as const,...current};
  next[coordinate]=step.binding.operation==="add" ? next[coordinate]+Number(step.binding.value) : Number(step.binding.value);
  return next;
}
/** Interpret a console command without affecting the drawing. */
function nextPosition(pos:ConsolePosition,step:CommandStep,bounds:Bounds):ConsolePosition {
  const property=step.binding.property;
  if (CATALOG[property]?.appliesTo!=="console" || property==="consoleRemember") return pos;
  return property==="consoleDock" ? changeDock(pos,step) : changeCoordinate(pos,step,bounds);
}
/** Interpret console commands after restoring a saved placement baseline. */
export function evaluatePosition(base:ConsolePosition, active:readonly CommandStep[], ...bounds:Bounds): Coordinates & {dock:Dock} {
  const position=active.reduce((pos,step)=>nextPosition(pos,step,bounds),{...base});
  return {...dockPosition(position,...bounds),dock:position.dock};
}
