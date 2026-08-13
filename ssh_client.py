#!/usr/bin/env python3
"""Minimal SSH client using libssh2 via ctypes"""
import ctypes
import ctypes.util
import socket
import sys
import os

# Load libssh2
libssh2_paths = [
    '/nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/libssh2.so.1.0.1',
    '/nix/store/gqrbbhxahk4mayblnc0sfpksgph197bb-libssh2-1.11.0/lib/libssh2.so.1.0.1',
    'libssh2.so.1',
    'libssh2.so',
]

lib = None
for p in libssh2_paths:
    try:
        lib = ctypes.CDLL(p)
        print("Loaded libssh2 from:", p, file=sys.stderr)
        break
    except:
        continue

if not lib:
    print("ERROR: Could not load libssh2", file=sys.stderr)
    sys.exit(1)

# Constants
LIBSSH2_SESSION_BLOCK_INBOUND = 0x0001
LIBSSH2_SESSION_BLOCK_OUTBOUND = 0x0002
LIBSSH2_ERROR_EAGAIN = -37

# Function signatures
lib.libssh2_init.argtypes = [ctypes.c_int]
lib.libssh2_init.restype = ctypes.c_int

lib.libssh2_session_init_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
lib.libssh2_session_init_ex.restype = ctypes.c_void_p

lib.libssh2_session_handshake.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libssh2_session_handshake.restype = ctypes.c_int

lib.libssh2_userauth_password.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lib.libssh2_userauth_password.restype = ctypes.c_int

lib.libssh2_channel_open_session.argtypes = [ctypes.c_void_p]
lib.libssh2_channel_open_session.restype = ctypes.c_void_p

lib.libssh2_channel_exec.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.libssh2_channel_exec.restype = ctypes.c_int

lib.libssh2_channel_read.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_int]
lib.libssh2_channel_read.restype = ctypes.c_ssize_t

lib.libssh2_channel_close.argtypes = [ctypes.c_void_p]
lib.libssh2_channel_close.restype = ctypes.c_int

lib.libssh2_channel_free.argtypes = [ctypes.c_void_p]
lib.libssh2_channel_free.restype = ctypes.c_int

lib.libssh2_session_disconnect_ex.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.libssh2_session_disconnect_ex.restype = ctypes.c_int

lib.libssh2_session_free.argtypes = [ctypes.c_void_p]
lib.libssh2_session_free.restype = ctypes.c_int

lib.libssh2_exit.argtypes = []
lib.libssh2_exit.restype = ctypes.c_void_p

# SSH channel read stream constants
SSH_CHANNEL_READ_STDOUT = 0
SSH_CHANNEL_READ_STDERR = 1

def ssh_exec(host, port, username, password, command, timeout=30):
    """Execute a command via SSH"""
    # Initialize libssh2
    rc = lib.libssh2_init(0)
    if rc != 0:
        return "ERROR: libssh2_init failed: " + str(rc)

    # Create socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
    except Exception as e:
        return "ERROR: socket connect failed: " + str(e)

    # Create session
    session = lib.libssh2_session_init_ex(None, None, None, None)
    if not session:
        sock.close()
        return "ERROR: session init failed"

    # Set blocking mode
    lib.libssh2_session_set_blocking(session, 1)

    # Handshake
    rc = lib.libssh2_session_handshake(session, sock.fileno())
    if rc != 0:
        lib.libssh2_session_free(session)
        sock.close()
        return "ERROR: handshake failed: " + str(rc)

    # Authenticate
    rc = lib.libssh2_userauth_password(session, username.encode(), password.encode())
    if rc != 0:
        lib.libssh2_session_disconnect_ex(session, 11, b"normal", b"")
        lib.libssh2_session_free(session)
        sock.close()
        return "ERROR: auth failed: " + str(rc)

    # Open channel
    channel = lib.libssh2_channel_open_session(session)
    if not channel:
        lib.libssh2_session_disconnect_ex(session, 11, b"normal", b"")
        lib.libssh2_session_free(session)
        sock.close()
        return "ERROR: channel open failed"

    # Execute command
    rc = lib.libssh2_channel_exec(channel, command.encode())
    if rc != 0:
        lib.libssh2_channel_free(channel)
        lib.libssh2_session_disconnect_ex(session, 11, b"normal", b"")
        lib.libssh2_session_free(session)
        sock.close()
        return "ERROR: exec failed: " + str(rc)

    # Read output
    output = b""
    buf = ctypes.create_string_buffer(4096)
    while True:
        n = lib.libssh2_channel_read(channel, buf, 4096, SSH_CHANNEL_READ_STDOUT)
        if n > 0:
            output += buf.raw[:n]
        elif n == 0:
            break
        elif n < 0 and n != LIBSSH2_ERROR_EAGAIN:
            break

    # Read stderr
    stderr_output = b""
    while True:
        n = lib.libssh2_channel_read(channel, buf, 4096, SSH_CHANNEL_READ_STDERR)
        if n > 0:
            stderr_output += buf.raw[:n]
        elif n == 0:
            break
        elif n < 0 and n != LIBSSH2_ERROR_EAGAIN:
            break

    # Close channel
    lib.libssh2_channel_close(channel)
    lib.libssh2_channel_free(channel)

    # Disconnect
    lib.libssh2_session_disconnect_ex(session, 11, b"normal", b"")
    lib.libssh2_session_free(session)
    sock.close()

    result = output.decode('utf-8', errors='replace')
    if stderr_output:
        result += "\n[STDERR]\n" + stderr_output.decode('utf-8', errors='replace')
    return result

# Check if libssh2_session_set_blocking exists
try:
    lib.libssh2_session_set_blocking.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.libssh2_session_set_blocking.restype = ctypes.c_void_p
except:
    pass

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "172.17.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 22
    username = sys.argv[3] if len(sys.argv) > 3 else "root"
    password = sys.argv[4] if len(sys.argv) > 4 else "M@dis0n_88_server**"
    command = sys.argv[5] if len(sys.argv) > 5 else "id"

    result = ssh_exec(host, port, username, password, command)
    print(result)
