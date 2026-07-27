from PIL import Image, ImageDraw
import os

def create_tray_icon(filename_1x, filename_2x, mode):
    for scale, filename in [(1, filename_1x), (2, filename_2x)]:
        size = 22 * scale
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        cx, cy = size / 2.0, size / 2.0
        
        if mode == "idle":
          # Minimal 3-bar waveform mic in white (macOS template)
          h1 = 6 * scale
          draw.rounded_rectangle([cx - 5*scale, cy - h1/2, cx - 3*scale, cy + h1/2], radius=1*scale, fill=(255, 255, 255, 220))
          h2 = 12 * scale
          draw.rounded_rectangle([cx - 1*scale, cy - h2/2, cx + 1*scale, cy + h2/2], radius=1*scale, fill=(255, 255, 255, 255))
          h3 = 8 * scale
          draw.rounded_rectangle([cx + 3*scale, cy - h3/2, cx + 5*scale, cy + h3/2], radius=1*scale, fill=(255, 255, 255, 220))
          
        elif mode == "recording":
          # Crisp minimal ruby recording ring + central dot
          r_outer = 7 * scale
          draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=(244, 63, 94, 255), width=int(1.5*scale))
          r_dot = 3 * scale
          draw.ellipse([cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot], fill=(244, 63, 94, 255))

        elif mode == "transcribing":
          # Crisp minimal amber 3-bar processing pulse
          h1 = 5 * scale
          draw.rounded_rectangle([cx - 5*scale, cy - h1/2, cx - 3*scale, cy + h1/2], radius=1*scale, fill=(245, 158, 11, 200))
          h2 = 11 * scale
          draw.rounded_rectangle([cx - 1*scale, cy - h2/2, cx + 1*scale, cy + h2/2], radius=1*scale, fill=(245, 158, 11, 255))
          h3 = 7 * scale
          draw.rounded_rectangle([cx + 3*scale, cy - h3/2, cx + 5*scale, cy + h3/2], radius=1*scale, fill=(245, 158, 11, 200))

        img.save(filename, "PNG")
        print(f"Generated {filename} ({size}x{size})")

os.makedirs("src/assets", exist_ok=True)
create_tray_icon("src/assets/tray-idleTemplate.png", "src/assets/tray-idleTemplate@2x.png", "idle")
create_tray_icon("src/assets/tray-recording.png", "src/assets/tray-recording@2x.png", "recording")
create_tray_icon("src/assets/tray-transcribing.png", "src/assets/tray-transcribing@2x.png", "transcribing")
