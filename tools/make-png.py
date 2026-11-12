"""make-png.py: writes a small solid-color PNG with no dependencies. Used to make test and example images.

Usage: python3 tools/make-png.py out.png 120 60 7852ee

Project: site-engine
@author Claude (Anthropic), written for and prompted by William Munnich
@date Last edited 2026-11-12
"""
import struct, sys, zlib
def png(path, w, h, rgb):
    """Writes a solid-color PNG file.

    @param path: where to write the PNG.
    @param w: width in pixels.
    @param h: height in pixels.
    @param rgb: the color as six hex digits, e.g. 7852ee.
    """
    r, g, b = bytes.fromhex(rgb)
    raw = b''.join(b'\x00' + bytes([r, g, b]) * w for _ in range(h))
    # Builds one PNG chunk: length, type, data, CRC.
    # @param t: the four-byte chunk type.
    # @param d: the chunk data.
    # @return: the chunk bytes.
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
png(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
