from PIL import Image, ImageDraw
import os
import sys

src = r"C:\Users\23817\Documents\xwechat_files\wxid_fzzn6by4wa3822_78c7\temp\RWTemp\2026-08\23ca49aedc2197302d8dd59d60b6d0f0\e9d29e877ce590ff98ede02b6da27d9d.jpg"
base = r"D:\PersonalWorkspace\yingling-android"

img = Image.open(src).convert("RGBA")

# Use a square crop from center
w, h = img.size
size = min(w, h)
left = (w - size) // 2
top = (h - size) // 2
img = img.crop((left, top, left + size, top + size))

def save_icon(img, path, s, corner_radius_ratio=0.22):
    """Resize and save with rounded corners for Android, square for PWA"""
    resized = img.resize((s, s), Image.LANCZOS)
    
    # For Android launcher icons, apply rounded corners (adaptive icon style)
    if 'android-res' in path or 'mipmap' in path:
        # Create mask with rounded corners
        mask = Image.new('L', (s, s), 0)
        draw = ImageDraw.Draw(mask)
        r = int(s * corner_radius_ratio)
        draw.rounded_rectangle((0, 0, s, s), radius=r, fill=255)
        
        # Apply mask
        rounded = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        rounded.paste(resized, (0, 0))
        rounded.putalpha(mask)
        resized = rounded
    
    # Convert to RGB for JPEG-like icons if no transparency needed
    if resized.mode == 'RGBA':
        bg = Image.new('RGB', (s, s), (250, 247, 242))
        bg.paste(resized, mask=resized.split()[3])
        resized = bg
    
    resized.save(path, 'PNG')
    print(f"Saved: {path}")

# PWA icons
pwa_dir = os.path.join(base, "www", "icons")
os.makedirs(pwa_dir, exist_ok=True)
save_icon(img, os.path.join(pwa_dir, "icon-192.png"), 192, corner_radius_ratio=0)
save_icon(img, os.path.join(pwa_dir, "icon-512.png"), 512, corner_radius_ratio=0)

# Also save a copy for apple-touch-icon
save_icon(img, os.path.join(pwa_dir, "icon.png"), 192, corner_radius_ratio=0.15)

# Android icons
android_dirs = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for dname, s in android_dirs.items():
    d = os.path.join(base, "android-res", dname)
    os.makedirs(d, exist_ok=True)
    save_icon(img, os.path.join(d, "ic_launcher.png"), s)
    save_icon(img, os.path.join(d, "ic_launcher_round.png"), s)
    
    # Also update android/app/src/main/res
    app_d = os.path.join(base, "android", "app", "src", "main", "res", dname)
    os.makedirs(app_d, exist_ok=True)
    save_icon(img, os.path.join(app_d, "ic_launcher.png"), s)
    save_icon(img, os.path.join(app_d, "ic_launcher_round.png"), s)

# Generate SVG (simple reference to PNG for PWA)
svg_path = os.path.join(pwa_dir, "icon.svg")
with open(svg_path, 'w', encoding='utf-8') as f:
    f.write('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <image href="icon-512.png" width="512" height="512"/>
</svg>''')
print(f"Saved: {svg_path}")

print("\nAll icons generated successfully!")
