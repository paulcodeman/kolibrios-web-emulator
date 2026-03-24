const FLAG_CF: u32 = 0x00000001;
const FLAG_AF: u32 = 0x00000010;
const FLAG_PF: u32 = 0x00000004;
const FLAG_ZF: u32 = 0x00000040;
const FLAG_SF: u32 = 0x00000080;
const FLAG_OF: u32 = 0x00000800;
const ALU_FLAG_MASK: u32 = FLAG_CF | FLAG_PF | FLAG_ZF | FLAG_SF | FLAG_OF;

var shift_rotate_last_result: u32 = 0;
var shift_rotate_last_flags: u32 = 0;
var shift_rotate_last_ok: u32 = 0;

var double_shift_last_result: u32 = 0;
var double_shift_last_flags: u32 = 0;
var double_shift_last_ok: u32 = 0;

fn shiftCount32(value: u32) u5 {
    return @intCast(value & 31);
}

fn widthMask(width_bits: u32) u32 {
    return switch (width_bits) {
        8 => 0xff,
        16 => 0xffff,
        else => 0xffffffff,
    };
}

fn widthSign(width_bits: u32) u32 {
    return switch (width_bits) {
        8 => 0x80,
        16 => 0x8000,
        else => 0x80000000,
    };
}

fn widthValueUnsigned(value: u32, width_bits: u32) u32 {
    if (width_bits == 32) {
        return value;
    }
    return value & widthMask(width_bits);
}

fn parityEven8Impl(value: u32) bool {
    var v = value & 0xff;
    v ^= v >> 4;
    v &= 0xf;
    const shift: u5 = @intCast(v & 31);
    return (((@as(u32, 0x6996) >> shift) & 1) == 0);
}

fn jsSignedShiftRight(value: u32, count: u32) u32 {
    const shift: u5 = shiftCount32(count);
    const signed_value: i32 = @bitCast(value);
    const result: i32 = signed_value >> shift;
    return @bitCast(result);
}

fn shl32(value: u32, count: u32) u32 {
    return value << shiftCount32(count);
}

fn shr32(value: u32, count: u32) u32 {
    return value >> shiftCount32(count);
}

pub export fn api_version() u32 {
    return 1;
}

pub export fn parity_even8(value: u32) u32 {
    return if (parityEven8Impl(value)) @as(u32, 1) else @as(u32, 0);
}

pub export fn update_logic_flags_width(flags: u32, result: u32, width_bits: u32) u32 {
    var next = flags & ~ALU_FLAG_MASK;
    const mask = widthMask(width_bits);
    const sign = widthSign(width_bits);
    const res = result & mask;
    if (res == 0) {
        next |= FLAG_ZF;
    }
    if ((res & sign) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(res)) {
        next |= FLAG_PF;
    }
    return next;
}

pub export fn update_add_flags(flags: u32, op1: u32, op2: u32, result: u32, width_bits: u32) u32 {
    const mask = widthMask(width_bits);
    const sign = widthSign(width_bits);
    const a = widthValueUnsigned(op1, width_bits);
    const b = widthValueUnsigned(op2, width_bits);
    const res = widthValueUnsigned(result, width_bits);
    const full = @as(u64, a) + @as(u64, b);
    const full_mask: u64 = if (width_bits == 32) 0xffffffff else @as(u64, mask);
    var next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
    if (full > full_mask) {
        next |= FLAG_CF;
    }
    if (((a ^ b ^ res) & 0x10) != 0) {
        next |= FLAG_AF;
    }
    if (((~(a ^ b)) & (a ^ res) & sign) != 0) {
        next |= FLAG_OF;
    }
    if (res == 0) {
        next |= FLAG_ZF;
    }
    if ((res & sign) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(res)) {
        next |= FLAG_PF;
    }
    return next;
}

pub export fn update_adc_flags(flags: u32, op1: u32, op2: u32, carry: u32, result: u32, width_bits: u32) u32 {
    const mask = widthMask(width_bits);
    const sign = widthSign(width_bits);
    const carry_value: u32 = if ((carry & 1) != 0) @as(u32, 1) else @as(u32, 0);
    const a = widthValueUnsigned(op1, width_bits);
    const b = widthValueUnsigned(op2, width_bits);
    const res = widthValueUnsigned(result, width_bits);
    const full = @as(u64, a) + @as(u64, b) + @as(u64, carry_value);
    const full_mask: u64 = if (width_bits == 32) 0xffffffff else @as(u64, mask);
    const b2 = (b +% carry_value) & mask;
    var next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
    if (full > full_mask) {
        next |= FLAG_CF;
    }
    if (((a ^ b2 ^ res) & 0x10) != 0) {
        next |= FLAG_AF;
    }
    if (((~(a ^ b2)) & (a ^ res) & sign) != 0) {
        next |= FLAG_OF;
    }
    if (res == 0) {
        next |= FLAG_ZF;
    }
    if ((res & sign) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(res)) {
        next |= FLAG_PF;
    }
    return next;
}

pub export fn update_sbb_flags(flags: u32, op1: u32, op2: u32, carry: u32, result: u32, width_bits: u32) u32 {
    const sign = widthSign(width_bits);
    const carry_value: u32 = if ((carry & 1) != 0) @as(u32, 1) else @as(u32, 0);
    const a = widthValueUnsigned(op1, width_bits);
    const b = widthValueUnsigned(op2, width_bits);
    const sub = b +% carry_value;
    const res = widthValueUnsigned(result, width_bits);
    var next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
    if (a < sub) {
        next |= FLAG_CF;
    }
    if (((a ^ sub ^ res) & 0x10) != 0) {
        next |= FLAG_AF;
    }
    if (((a ^ sub) & (a ^ res) & sign) != 0) {
        next |= FLAG_OF;
    }
    if (res == 0) {
        next |= FLAG_ZF;
    }
    if ((res & sign) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(res)) {
        next |= FLAG_PF;
    }
    return next;
}

pub export fn update_sub_flags(flags: u32, op1: u32, op2: u32, result: u32, width_bits: u32) u32 {
    const sign = widthSign(width_bits);
    const a = widthValueUnsigned(op1, width_bits);
    const b = widthValueUnsigned(op2, width_bits);
    const res = widthValueUnsigned(result, width_bits);
    var next = flags & ~(ALU_FLAG_MASK | FLAG_AF);
    if (b > a) {
        next |= FLAG_CF;
    }
    if (((a ^ b ^ res) & 0x10) != 0) {
        next |= FLAG_AF;
    }
    if (((a ^ b) & (a ^ res) & sign) != 0) {
        next |= FLAG_OF;
    }
    if (res == 0) {
        next |= FLAG_ZF;
    }
    if ((res & sign) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(res)) {
        next |= FLAG_PF;
    }
    return next;
}

pub export fn shift_rotate_exec(value: u32, count: u32, width_bits: u32, mode: u32, flags: u32) void {
    const mask = widthMask(width_bits);
    const sign_bit = widthSign(width_bits);
    const v = value & mask;
    var c = count & 0x1f;
    if (c == 0) {
        shift_rotate_last_result = v;
        shift_rotate_last_flags = flags;
        shift_rotate_last_ok = 1;
        return;
    }

    var result = v;
    var cf: u32 = if ((flags & FLAG_CF) != 0) @as(u32, 1) else @as(u32, 0);
    var next = flags;

    switch (mode & 7) {
        0 => {
            c %= width_bits;
            if (c == 0) {
                shift_rotate_last_result = v;
                shift_rotate_last_flags = flags;
                shift_rotate_last_ok = 1;
                return;
            }
            result = (shl32(v, c) | shr32(v, width_bits - c)) & mask;
            cf = result & 1;
            next = flags & ~(FLAG_CF | FLAG_OF);
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1) {
                const of: u32 = if ((((result & sign_bit) != 0) != (cf != 0))) @as(u32, 1) else @as(u32, 0);
                if (of != 0) {
                    next |= FLAG_OF;
                }
            }
        },
        1 => {
            c %= width_bits;
            if (c == 0) {
                shift_rotate_last_result = v;
                shift_rotate_last_flags = flags;
                shift_rotate_last_ok = 1;
                return;
            }
            result = (shr32(v, c) | shl32(v, width_bits - c)) & mask;
            cf = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
            next = flags & ~(FLAG_CF | FLAG_OF);
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1) {
                const msb: u32 = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
                const next_msb = shr32(result, width_bits - 2) & 1;
                if ((msb ^ next_msb) != 0) {
                    next |= FLAG_OF;
                }
            }
        },
        2 => {
            const mod = width_bits + 1;
            c %= mod;
            if (c == 0) {
                shift_rotate_last_result = v;
                shift_rotate_last_flags = flags;
                shift_rotate_last_ok = 1;
                return;
            }
            result = v;
            var i: u32 = 0;
            while (i < c) : (i += 1) {
                const new_cf: u32 = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
                result = ((shl32(result, 1)) & mask) | (if (cf != 0) @as(u32, 1) else @as(u32, 0));
                cf = new_cf;
            }
            next = flags & ~(FLAG_CF | FLAG_OF);
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1) {
                const msb: u32 = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
                if ((msb ^ cf) != 0) {
                    next |= FLAG_OF;
                }
            }
        },
        3 => {
            const mod = width_bits + 1;
            c %= mod;
            if (c == 0) {
                shift_rotate_last_result = v;
                shift_rotate_last_flags = flags;
                shift_rotate_last_ok = 1;
                return;
            }
            result = v;
            var i: u32 = 0;
            while (i < c) : (i += 1) {
                const new_cf = result & 1;
                result = shr32(result, 1) | (if (cf != 0) sign_bit else @as(u32, 0));
                cf = new_cf;
            }
            next = flags & ~(FLAG_CF | FLAG_OF);
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1) {
                const msb: u32 = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
                const next_msb = shr32(result, width_bits - 2) & 1;
                if ((msb ^ next_msb) != 0) {
                    next |= FLAG_OF;
                }
            }
        },
        4 => {
            if (c >= width_bits) {
                result = 0;
                cf = 0;
            } else {
                cf = shr32(v, width_bits - c) & 1;
                result = shl32(v, c) & mask;
            }
            next = flags & ~ALU_FLAG_MASK;
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1) {
                const msb: u32 = if ((result & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
                if ((msb ^ cf) != 0) {
                    next |= FLAG_OF;
                }
            }
            if (result == 0) {
                next |= FLAG_ZF;
            }
            if ((result & sign_bit) != 0) {
                next |= FLAG_SF;
            }
            if (parityEven8Impl(result)) {
                next |= FLAG_PF;
            }
        },
        5 => {
            if (c >= width_bits) {
                result = 0;
                cf = shr32(v, width_bits - 1) & 1;
            } else {
                cf = shr32(v, c - 1) & 1;
                result = shr32(v, c);
            }
            next = flags & ~ALU_FLAG_MASK;
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (c == 1 and (v & sign_bit) != 0) {
                next |= FLAG_OF;
            }
            if (result == 0) {
                next |= FLAG_ZF;
            }
            if ((result & sign_bit) != 0) {
                next |= FLAG_SF;
            }
            if (parityEven8Impl(result)) {
                next |= FLAG_PF;
            }
        },
        7 => {
            if (c >= width_bits) {
                result = if ((v & sign_bit) != 0) mask else @as(u32, 0);
                cf = if ((v & sign_bit) != 0) @as(u32, 1) else @as(u32, 0);
            } else {
                cf = shr32(v, c - 1) & 1;
                result = jsSignedShiftRight(v, c) & mask;
            }
            next = flags & ~ALU_FLAG_MASK;
            if (cf != 0) {
                next |= FLAG_CF;
            }
            if (result == 0) {
                next |= FLAG_ZF;
            }
            if ((result & sign_bit) != 0) {
                next |= FLAG_SF;
            }
            if (parityEven8Impl(result)) {
                next |= FLAG_PF;
            }
        },
        else => {
            shift_rotate_last_result = v;
            shift_rotate_last_flags = flags;
            shift_rotate_last_ok = 0;
            return;
        },
    }

    shift_rotate_last_result = result;
    shift_rotate_last_flags = next;
    shift_rotate_last_ok = 1;
}

pub export fn get_shift_rotate_last_result() u32 {
    return shift_rotate_last_result;
}

pub export fn get_shift_rotate_last_flags() u32 {
    return shift_rotate_last_flags;
}

pub export fn get_shift_rotate_last_ok() u32 {
    return shift_rotate_last_ok;
}

pub export fn double_shift_exec(value: u32, source: u32, count: u32, width_bits: u32, left_shift: u32, flags: u32) void {
    const mask = widthMask(width_bits);
    const sign_bit = widthSign(width_bits);
    var c = count & 0x1f;
    const dst = value & mask;
    const src = source & mask;
    if (c == 0) {
        double_shift_last_result = dst;
        double_shift_last_flags = flags;
        double_shift_last_ok = 1;
        return;
    }
    if (c > width_bits) {
        c = width_bits;
    }

    var result = dst;
    var cf: u32 = 0;
    if ((left_shift & 1) != 0) {
        if (c == width_bits) {
            result = src;
            cf = dst & 1;
        } else {
            result = (shl32(dst, c) | shr32(src, width_bits - c)) & mask;
            cf = shr32(dst, width_bits - c) & 1;
        }
    } else {
        if (c == width_bits) {
            result = src;
            cf = shr32(dst, width_bits - 1) & 1;
        } else {
            result = (shr32(dst, c) | (shl32(src, width_bits - c) & mask)) & mask;
            cf = shr32(dst, c - 1) & 1;
        }
    }

    var next = flags & ~(FLAG_CF | FLAG_OF | FLAG_SF | FLAG_ZF | FLAG_PF);
    if (cf != 0) {
        next |= FLAG_CF;
    }
    if ((result & mask) == 0) {
        next |= FLAG_ZF;
    }
    if ((result & sign_bit) != 0) {
        next |= FLAG_SF;
    }
    if (parityEven8Impl(result)) {
        next |= FLAG_PF;
    }
    if (c == 1) {
        if ((left_shift & 1) != 0) {
            const msb = (result & sign_bit) != 0;
            if (msb != (cf != 0)) {
                next |= FLAG_OF;
            }
        } else {
            const before_msb = (dst & sign_bit) != 0;
            const after_msb = (result & sign_bit) != 0;
            if (before_msb != after_msb) {
                next |= FLAG_OF;
            }
        }
    }

    double_shift_last_result = result & mask;
    double_shift_last_flags = next;
    double_shift_last_ok = 1;
}

pub export fn get_double_shift_last_result() u32 {
    return double_shift_last_result;
}

pub export fn get_double_shift_last_flags() u32 {
    return double_shift_last_flags;
}

pub export fn get_double_shift_last_ok() u32 {
    return double_shift_last_ok;
}
