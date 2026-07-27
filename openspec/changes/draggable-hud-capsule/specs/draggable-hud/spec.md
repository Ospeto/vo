# Spec Delta: Draggable HUD Capsule

## Added Requirements

### Requirement: Mouse Draggable HUD Window
The minimalist micro-waveform HUD capsule MUST allow mouse click-and-drag interaction to reposition the window across the display.

#### Scenario: Dragging HUD Capsule
- **Given** the HUD capsule is visible on screen during dictation
- **When** the user clicks and drags the HUD capsule with their mouse
- **Then** the HUD window MUST move smoothly to the new mouse coordinates and save the updated position.
