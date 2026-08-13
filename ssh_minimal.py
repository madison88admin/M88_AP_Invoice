#!/usr/bin/env python3
"""Minimal SSH2 client using Python + ctypes for AES"""
import socket, struct, hashlib, hmac, os, sys, ctypes

lib = ctypes.CDLL('/usr/lib/x86_64-linux-gnu/libcrypto.so.1.1')
lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
lib.EVP_aes_256_ctr.restype = ctypes.c_void_p
lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
lib.EVP_EncryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lib.EVP_EncryptInit_ex.restype = ctypes.c_int
lib.EVP_EncryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int]
lib.EVP_EncryptUpdate.restype = ctypes.c_int
lib.EVP_EncryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
lib.EVP_EncryptFinal_ex.restype = ctypes.c_int
lib.EVP_DecryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lib.EVP_DecryptInit_ex.restype = ctypes.c_int
lib.EVP_DecryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int]
lib.EVP_DecryptUpdate.restype = ctypes.c_int
lib.EVP_DecryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
lib.EVP_DecryptFinal_ex.restype = ctypes.c_int
lib.RAND_bytes.argtypes = [ctypes.c_char_p, ctypes.c_int]
lib.RAND_bytes.restype = ctypes.c_int

class AES_CTR:
    def __init__(self, key, iv, encrypt=True):
        self.ctx = lib.EVP_CIPHER_CTX_new()
        self.cipher = lib.EVP_aes_256_ctr()
        if encrypt:
            lib.EVP_EncryptInit_ex(self.ctx, self.cipher, None, key, iv)
        else:
            lib.EVP_DecryptInit_ex(self.ctx, self.cipher, None, key, iv)

    def process(self, data):
        out = ctypes.create_string_buffer(len(data) + 32)
        outlen = ctypes.c_int(0)
        if hasattr(lib, '_encrypt_mode'):
            lib.EVP_EncryptUpdate(self.ctx, out, ctypes.byref(outlen), data, len(data))
        else:
            lib.EVP_DecryptUpdate(self.ctx, out, ctypes.byref(outlen), data, len(data))
        return out.raw[:outlen.value]

    def encrypt(self, data):
        out = ctypes.create_string_buffer(len(data) + 32)
        outlen = ctypes.c_int(0)
        lib.EVP_EncryptUpdate(self.ctx, out, ctypes.byref(outlen), data, len(data))
        return out.raw[:outlen.value]

    def decrypt(self, data):
        out = ctypes.create_string_buffer(len(data) + 32)
        outlen = ctypes.c_int(0)
        lib.EVP_DecryptUpdate(self.ctx, out, ctypes.byref(outlen), data, len(data))
        return out.raw[:outlen.value]

    def close(self):
        if self.ctx:
            lib.EVP_CIPHER_CTX_free(self.ctx)

# DH group 14 prime (2048-bit)
P = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D"
    "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D"
    "670C354E4ABC9804F1746F08C18247A5A14C03F6E6F7B6B7"
    "1F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6"
    "F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F"
    "0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B7"
    "1F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6"
    "F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F"
    "0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B7"
    "1F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6"
    "F7B6B71F1F0F0BD6E6F7B6B71F1F0F0BD6E6F7B6B71F1F0F"
    "0BD6E6F7B6B71F1F0F0BD6", 16)
G = 2

def ssh_string(data):
    if isinstance(data, int):
        data = data.to_bytes((data.bit_length() + 7) // 8, 'big')
    if isinstance(data, str):
        data = data.encode()
    return struct.pack('>I', len(data)) + data

def ssh_mpint(n):
    if n == 0:
        return struct.pack('>I', 0)
    b = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    if b[0] & 0x80:
        b = b'\x00' + b
    return struct.pack('>I', len(b)) + b

def read_uint32(data, off):
    return struct.unpack('>I', data[off:off+4])[0], off + 4

def read_string(data, off):
    n, off = read_uint32(data, off)
    return data[off:off+n], off + n

def read_mpint(data, off):
    n, off = read_uint32(data, off)
    raw = data[off:off+n]
    if len(raw) == 0:
        return 0, off + n
    return int.from_bytes(raw, 'big'), off + n

def make_packet(payload, block_size=8):
    pad_len = block_size - ((5 + len(payload)) % block_size)
    if pad_len < 4:
        pad_len += block_size
    padded = struct.pack('B', pad_len) + payload + os.urandom(pad_len)
    return struct.pack('>I', len(padded)) + padded

def send_packet(sock, payload, encryptor=None, mac_key=None, seq=0):
    pkt = make_packet(payload)
    if encryptor:
        # Encrypt everything except the first 4 bytes (packet length)
        # Actually in SSH, the entire packet is encrypted (including length)
        enc = encryptor.encrypt(pkt)
        # Compute MAC
        mac_data = struct.pack('>I', seq) + pkt
        mac = hmac.new(mac_key, mac_data, hashlib.sha256).digest()[:32]
        sock.sendall(enc + mac)
    else:
        sock.sendall(pkt)

def recv_packet(sock, decryptor=None, mac_key=None, seq=0):
    DEBUG = os.environ.get('SSH_DEBUG', '0') == '1'
    def dbg(msg):
        if DEBUG:
            sys.stderr.write("[recv] " + msg + "\n")
            sys.stderr.flush()

    block_size = 16 if decryptor else 8
    # Read first block
    header = b''
    while len(header) < block_size:
        chunk = sock.recv(block_size - len(header))
        if not chunk:
            raise Exception("Connection closed during recv")
        header += chunk
    if decryptor:
        header = decryptor.decrypt(header)
    pkt_len = struct.unpack('>I', header[:4])[0]
    dbg("packet length: %d" % pkt_len)
    if pkt_len > 100000 or pkt_len < 1:
        raise Exception("Invalid packet length: %d (header hex: %s)" % (pkt_len, header[:16].hex()))
    # Read the rest of the packet
    remaining = header[4:]
    total_needed = pkt_len
    while len(remaining) < total_needed:
        chunk = sock.recv(total_needed - len(remaining))
        if not chunk:
            raise Exception("Connection closed during recv")
        remaining += chunk
    if decryptor:
        remaining = decryptor.decrypt(remaining)
    pad_len = remaining[0]
    payload = remaining[1:1 + pkt_len - pad_len - 1]
    # Read MAC
    if mac_key:
        mac = b''
        while len(mac) < 32:
            chunk = sock.recv(32 - len(mac))
            if not chunk:
                raise Exception("Connection closed during MAC recv")
            mac += chunk
    dbg("message type: %d, payload len: %d" % (payload[0] if payload else -1, len(payload)))
    return payload

def ssh_exec(host, port, user, password, command):
    DEBUG = os.environ.get('SSH_DEBUG', '0') == '1'
    def dbg(msg):
        if DEBUG:
            sys.stderr.write(msg + "\n")
            sys.stderr.flush()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    sock.connect((host, port))
    dbg("Connected to %s:%d" % (host, port))

    # Version exchange
    sock.sendall(b"SSH-2.0-pyssh_0.1\r\n")
    banner = b""
    while b"\n" not in banner:
        banner += sock.recv(256)
    server_ver = banner.strip().split(b"\r\n")[0]
    dbg("Server version: %s" % server_ver.decode())
    # Read any extra data before KEXINIT
    extra = b""
    while True:
        # Check if there's already data in banner after the version line
        parts = banner.split(b"\n", 1)
        if len(parts) > 1:
            extra = parts[1]
        break

    # Read server KEXINIT
    data = extra
    while len(data) < 5:
        data += sock.recv(4096)
    pkt_len = struct.unpack('>I', data[:4])[0]
    dbg("Server KEXINIT packet length: %d" % pkt_len)
    while len(data) < 4 + pkt_len:
        data += sock.recv(4096)
    pad_len = data[4]
    server_kexinit = data[5:5 + pkt_len - pad_len]
    dbg("Server KEXINIT message type: %d" % server_kexinit[0])

    # Build our KEXINIT
    cookie = os.urandom(16)
    kex = b"\x14" + cookie  # SSH_MSG_KEXINIT
    kex += ssh_string(b"diffie-hellman-group14-sha256")
    kex += ssh_string(b"ssh-rsa,ssh-ed25519,ecdsa-sha2-nistp256,rsa-sha2-256,rsa-sha2-512")
    kex += ssh_string(b"aes256-ctr")
    kex += ssh_string(b"aes256-ctr")
    kex += ssh_string(b"hmac-sha2-256")
    kex += ssh_string(b"hmac-sha2-256")
    kex += ssh_string(b"none")
    kex += ssh_string(b"none")
    kex += ssh_string(b"")
    kex += ssh_string(b"")
    kex += b"\x00" + struct.pack('>I', 0)

    client_kexinit_pkt = make_packet(kex)
    sock.sendall(client_kexinit_pkt)

    # DH key exchange
    x = int.from_bytes(os.urandom(32), 'big')
    e = pow(G, x, P)
    dbg("DH: computed e (%d bits)" % e.bit_length())

    kexdh_init = b"\x1e" + ssh_mpint(e)  # SSH_MSG_KEXDH_INIT (30)
    sock.sendall(make_packet(kexdh_init))
    dbg("Sent KEXDH_INIT")

    # Read KEXDH_REPLY
    data = b""
    while len(data) < 5:
        data += sock.recv(4096)
    pkt_len = struct.unpack('>I', data[:4])[0]
    dbg("KEXDH_REPLY packet length: %d" % pkt_len)
    while len(data) < 4 + pkt_len:
        data += sock.recv(4096)
    pad_len = data[4]
    reply = data[5:5 + pkt_len - pad_len]

    msg_type = reply[0]
    dbg("KEXDH_REPLY message type: %d" % msg_type)
    if msg_type != 31:
        return "ERROR: Expected KEXDH_REPLY(31), got " + str(msg_type)

    off = 1
    host_key, off = read_string(reply, off)
    f, off = read_mpint(reply, off)
    sig, off = read_string(reply, off)

    K = pow(f, x, P)
    H = hashlib.sha256()
    H.update(ssh_string(b"SSH-2.0-pyssh_0.1"))
    H.update(ssh_string(server_ver))
    H.update(ssh_string(kex))
    H.update(ssh_string(server_kexinit))
    H.update(ssh_string(host_key))
    H.update(ssh_mpint(e))
    H.update(ssh_mpint(f))
    H.update(ssh_mpint(K))
    H_hash = H.digest()

    # Send NEWKEYS
    sock.sendall(make_packet(b"\x15"))  # SSH_MSG_NEWKEYS (21)
    dbg("Sent NEWKEYS")

    # Read NEWKEYS
    data = b""
    while len(data) < 5:
        data += sock.recv(4096)
    pkt_len = struct.unpack('>I', data[:4])[0]
    while len(data) < 4 + pkt_len:
        data += sock.recv(4096)
    dbg("Received NEWKEYS")

    # Derive keys
    session_id = H_hash
    def derive_key(letter, length):
        k1 = hashlib.sha256(ssh_mpint(K) + H_hash + letter.encode() + session_id).digest()
        result = k1
        while len(result) < length:
            k1 = hashlib.sha256(ssh_mpint(K) + H_hash + result).digest()
            result += k1
        return result[:length]

    enc_key_c2s = derive_key('A', 32)
    enc_key_s2c = derive_key('B', 32)
    enc_iv_c2s = derive_key('C', 16)
    enc_iv_s2c = derive_key('D', 16)
    mac_key_c2s = derive_key('E', 32)
    mac_key_s2c = derive_key('F', 32)
    dbg("Derived keys: c2s_key=%s s2c_key=%s" % (enc_key_c2s[:4].hex(), enc_key_s2c[:4].hex()))

    enc_c2s = AES_CTR(enc_key_c2s, enc_iv_c2s, encrypt=True)
    enc_s2c = AES_CTR(enc_key_s2c, enc_iv_s2c, encrypt=False)

    # Authentication
    auth = b"\x32"  # SSH_MSG_USERAUTH_REQUEST (50)
    auth += ssh_string(user)
    auth += ssh_string(b"ssh-connection")
    auth += ssh_string(b"password")
    auth += b"\x00"  # FALSE (not changing password)
    auth += ssh_string(password)

    send_packet(sock, auth, enc_c2s, mac_key_c2s, 3)
    dbg("Sent auth request for user %s" % user)

    # Read auth response
    resp = recv_packet(sock, enc_s2c, mac_key_s2c, 3)
    msg = resp[0]
    dbg("Auth response: %d" % msg)
    if msg == 52:  # SSH_MSG_USERAUTH_SUCCESS
        dbg("Auth SUCCESS")
        pass
    elif msg == 51:  # SSH_MSG_USERAUTH_FAILURE
        methods, _ = read_string(resp, 1)
        return "ERROR: Auth failed. Methods: " + methods.decode()
    else:
        return "ERROR: Unexpected auth response: " + str(msg)

    # Open channel
    chan = b"\x5a"  # SSH_MSG_CHANNEL_OPEN (90)
    chan += ssh_string(b"session")
    chan += struct.pack('>I', 0)  # sender channel
    chan += struct.pack('>I', 0x100000)  # initial window size
    chan += struct.pack('>I', 0x4000)  # max packet size

    send_packet(sock, chan, enc_c2s, mac_key_c2s, 4)

    # Read channel open confirmation
    resp = recv_packet(sock, enc_s2c, mac_key_s2c, 4)
    if resp[0] != 91:  # SSH_MSG_CHANNEL_OPEN_CONFIRMATION
        return "ERROR: Channel open failed: " + str(resp[0])

    # Exec command
    exec_msg = b"\x62"  # SSH_MSG_CHANNEL_REQUEST (98)
    exec_msg += struct.pack('>I', 0)  # recipient channel
    exec_msg += ssh_string(b"exec")
    exec_msg += b"\x01"  # want reply
    exec_msg += ssh_string(command)

    send_packet(sock, exec_msg, enc_c2s, mac_key_c2s, 5)

    # Read output
    output = b""
    seq_s2c = 5
    while True:
        try:
            resp = recv_packet(sock, enc_s2c, mac_key_s2c, seq_s2c)
            seq_s2c += 1
            msg = resp[0]
            if msg == 94:  # SSH_MSG_CHANNEL_DATA
                _, off = read_uint32(resp, 1)
                data, _ = read_string(resp, off)
                output += data
            elif msg == 95:  # SSH_MSG_CHANNEL_EXTENDED_DATA
                _, off = read_uint32(resp, 1)
                _, off = read_uint32(resp, off)  # data type
                data, _ = read_string(resp, off)
                output += data
            elif msg == 96:  # SSH_MSG_CHANNEL_EOF
                pass
            elif msg == 97:  # SSH_MSG_CHANNEL_CLOSE
                break
            elif msg == 99:  # SSH_MSG_CHANNEL_SUCCESS
                pass
            elif msg == 93:  # SSH_MSG_CHANNEL_WINDOW_ADJUST
                pass
            else:
                break
        except socket.timeout:
            break

    enc_c2s.close()
    enc_s2c.close()
    sock.close()
    return output.decode('utf-8', errors='replace')

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "172.17.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 22
    user = sys.argv[3] if len(sys.argv) > 3 else "root"
    password = sys.argv[4] if len(sys.argv) > 4 else ""
    command = sys.argv[5] if len(sys.argv) > 5 else "id"
    result = ssh_exec(host, port, user, password, command)
    print(result)
