export interface GeometryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function calculatePopoverPosition(
  trayBounds: GeometryBounds,
  popoverDimensions: { width: number; height: number },
  screenBounds: GeometryBounds
): GeometryBounds {
  // Center popover horizontally relative to tray icon center
  const trayCenterX = trayBounds.x + trayBounds.width / 2;
  let targetX = Math.round(trayCenterX - popoverDimensions.width / 2);

  // Position popover directly below menu bar tray icon with 4px gap
  let targetY = Math.round(trayBounds.y + trayBounds.height + 4);

  // Flip above menu bar if vertical space below is insufficient
  if (targetY + popoverDimensions.height > screenBounds.y + screenBounds.height - 10) {
    targetY = Math.round(trayBounds.y - popoverDimensions.height - 4);
  }

  // Clamp horizontal placement within screen boundaries with 10px edge padding
  if (targetX < screenBounds.x + 10) {
    targetX = screenBounds.x + 10;
  } else if (targetX + popoverDimensions.width > screenBounds.x + screenBounds.width - 10) {
    targetX = screenBounds.x + screenBounds.width - popoverDimensions.width - 10;
  }

  return {
    x: targetX,
    y: targetY,
    width: popoverDimensions.width,
    height: popoverDimensions.height,
  };
}
