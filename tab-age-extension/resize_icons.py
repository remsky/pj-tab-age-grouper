from PIL import Image

img = Image.open("icons/logo.png")

# 16 and 48 are simple resizes
for size in [16, 48]:
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(f"icons/logo{size}.png")
    print(f"Created icons/logo{size}.png ({size}x{size})")

# 128 needs 96x96 icon centered with 16px transparent padding
icon_96 = img.resize((96, 96), Image.LANCZOS)
canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
canvas.paste(icon_96, (16, 16))
canvas.save("icons/logo128.png")
print("Created icons/logo128.png (96x96 centered in 128x128 with padding)")
