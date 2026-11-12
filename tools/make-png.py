"""Writes a small solid-color PNG with no dependencies: python3 tools/make-png.py out.png 120 60 7852ee"""
import struct, sys, zlib
def png(path, w, h, rgb):
    r, g, b = bytes.fromhex(rgb)
    raw = b''.join(b'\x00' + bytes([r, g, b]) * w for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
png(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
