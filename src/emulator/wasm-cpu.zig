const std = @import("std");

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

var packed64_last_lo: u32 = 0;
var packed64_last_hi: u32 = 0;
var packed_bcd_last: [10]u8 = [_]u8{0} ** 10;
var bit_scan_last_index: u32 = 0;
var bit_scan_last_zero: u32 = 1;
var bit_test_last_result: u32 = 0;
var bit_test_last_flags: u32 = 0;
var imul_last_result: u32 = 0;
var imul_last_flags: u32 = 0;
var x87_compare_last_code: u32 = 0;
var shift_packed64_last_lo: u32 = 0;
var shift_packed64_last_hi: u32 = 0;
var mul_last_lo: u32 = 0;
var mul_last_hi: u32 = 0;
var mul_last_flags: u32 = 0;

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

fn laneSigned16(value: u32) i32 {
    const narrowed: u16 = @truncate(value & 0xffff);
    const signed: i16 = @bitCast(narrowed);
    return @as(i32, signed);
}

fn laneSigned32(value: u32) i32 {
    return @bitCast(value);
}

fn clampSigned8From16(value: u32) u32 {
    var v = laneSigned16(value);
    if (v > 0x7f) {
        v = 0x7f;
    } else if (v < -0x80) {
        v = -0x80;
    }
    return @as(u32, @bitCast(@as(i32, v))) & 0xff;
}

fn clampUnsigned8From16(value: u32) u32 {
    var v = laneSigned16(value);
    if (v < 0) {
        v = 0;
    } else if (v > 0xff) {
        v = 0xff;
    }
    return @intCast(v & 0xff);
}

fn clampSigned16From32(value: u32) u32 {
    var v = laneSigned32(value);
    if (v > 0x7fff) {
        v = 0x7fff;
    } else if (v < -0x8000) {
        v = -0x8000;
    }
    return @as(u32, @bitCast(@as(i32, v))) & 0xffff;
}

fn setPacked64(lo: u32, hi: u32) void {
    packed64_last_lo = lo;
    packed64_last_hi = hi;
}

fn maxF64(a: f64, b: f64) f64 {
    return if (a > b) a else b;
}

fn absF64(value: f64) f64 {
    return if (value < 0.0 or std.math.signbit(value)) -value else value;
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

pub export fn round_ties_to_even(value: f64) f64 {
    if (!std.math.isFinite(value)) {
        return 0;
    }
    const floor_value = @floor(value);
    const frac = value - floor_value;
    const epsilon = 1e-9 * maxF64(1.0, @abs(value));
    if (frac < (0.5 - epsilon)) {
        return floor_value;
    }
    if (frac > (0.5 + epsilon)) {
        return floor_value + 1.0;
    }
    const floor_int: i64 = @intFromFloat(floor_value);
    return if ((floor_int & 1) == 0) floor_value else (floor_value + 1.0);
}

pub export fn x87_store_integer_value(value: f64, truncate: u32) f64 {
    if (!std.math.isFinite(value)) {
        return 0;
    }
    return if ((truncate & 1) != 0) @trunc(value) else round_ties_to_even(value);
}

pub export fn x87_packed_bcd_to_number(
    b0: u32,
    b1: u32,
    b2: u32,
    b3: u32,
    b4: u32,
    b5: u32,
    b6: u32,
    b7: u32,
    b8: u32,
    b9: u32,
) f64 {
    const values = [_]u32{
        b0 & 0xff, b1 & 0xff, b2 & 0xff, b3 & 0xff, b4 & 0xff,
        b5 & 0xff, b6 & 0xff, b7 & 0xff, b8 & 0xff, b9 & 0xff,
    };
    var magnitude: u64 = 0;
    var factor: u64 = 1;
    var i: usize = 0;
    while (i < 9) : (i += 1) {
        const packed_byte = values[i];
        magnitude += @as(u64, packed_byte & 0x0f) * factor;
        factor *= 10;
        magnitude += @as(u64, (packed_byte >> 4) & 0x0f) * factor;
        factor *= 10;
    }
    const value = @as(f64, @floatFromInt(magnitude));
    return if ((values[9] & 0x80) != 0) -value else value;
}

pub export fn x87_number_to_packed_bcd_exec(value: f64) void {
    var i: usize = 0;
    while (i < packed_bcd_last.len) : (i += 1) {
        packed_bcd_last[i] = 0;
    }
    const rounded = x87_store_integer_value(value, 0);
    if (!std.math.isFinite(rounded)) {
        return;
    }
    var magnitude: u64 = 0;
    const abs_value = absF64(rounded);
    if (abs_value > @as(f64, @floatFromInt(std.math.maxInt(u64)))) {
        magnitude = std.math.maxInt(u64);
    } else {
        magnitude = @intFromFloat(@trunc(abs_value));
    }
    i = 0;
    while (i < 9) : (i += 1) {
        const lo: u8 = @intCast(magnitude % 10);
        magnitude /= 10;
        const hi: u8 = @intCast(magnitude % 10);
        magnitude /= 10;
        packed_bcd_last[i] = lo | (hi << 4);
    }
    if (rounded < 0.0 or std.math.signbit(rounded)) {
        packed_bcd_last[9] = 0x80;
    }
}

pub export fn get_packed_bcd_last_byte(index: u32) u32 {
    if (index >= packed_bcd_last.len) {
        return 0;
    }
    return packed_bcd_last[index];
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

pub export fn eval_jcc_condition(cc: u32, flags: u32) u32 {
    const of = (flags & FLAG_OF) != 0;
    const cf = (flags & FLAG_CF) != 0;
    const zf = (flags & FLAG_ZF) != 0;
    const sf = (flags & FLAG_SF) != 0;
    const pf = (flags & FLAG_PF) != 0;
    const take = switch (cc & 0xf) {
        0x0 => of,
        0x1 => !of,
        0x2 => cf,
        0x3 => !cf,
        0x4 => zf,
        0x5 => !zf,
        0x6 => cf or zf,
        0x7 => !cf and !zf,
        0x8 => sf,
        0x9 => !sf,
        0xa => pf,
        0xb => !pf,
        0xc => sf != of,
        0xd => sf == of,
        0xe => zf or (sf != of),
        0xf => !zf and (sf == of),
        else => false,
    };
    return if (take) 1 else 0;
}

pub export fn bit_scan_exec(value: u32, reverse: u32, width_bits: u32) void {
    const src = widthValueUnsigned(value, width_bits);
    if (src == 0) {
        bit_scan_last_index = 0;
        bit_scan_last_zero = 1;
        return;
    }
    bit_scan_last_zero = 0;
    if ((reverse & 1) != 0) {
        bit_scan_last_index = 31 - @as(u32, @intCast(@clz(src)));
    } else {
        bit_scan_last_index = @as(u32, @intCast(@ctz(src)));
    }
}

pub export fn get_bit_scan_last_index() u32 {
    return bit_scan_last_index;
}

pub export fn get_bit_scan_last_zero() u32 {
    return bit_scan_last_zero;
}

pub export fn bit_test_modify_exec(value: u32, bit_index: u32, width_bits: u32, op: u32, flags: u32) void {
    const width: u32 = if (width_bits == 16) 16 else 32;
    const src = widthValueUnsigned(value, width);
    const bit: u32 = if (width == 16) (bit_index & 15) else (bit_index & 31);
    const bit_mask = shl32(@as(u32, 1), bit);
    const bit_value = if ((src & bit_mask) != 0) @as(u32, 1) else @as(u32, 0);
    bit_test_last_flags = (flags & ~FLAG_CF) | (if (bit_value != 0) FLAG_CF else @as(u32, 0));
    bit_test_last_result = src;
    switch (op & 7) {
        4 => {},
        5 => {
            bit_test_last_result = src | bit_mask;
        },
        6 => {
            bit_test_last_result = src & ~bit_mask;
        },
        7 => {
            bit_test_last_result = src ^ bit_mask;
        },
        else => {},
    }
    bit_test_last_result = widthValueUnsigned(bit_test_last_result, width);
}

pub export fn get_bit_test_last_result() u32 {
    return bit_test_last_result;
}

pub export fn get_bit_test_last_flags() u32 {
    return bit_test_last_flags;
}

pub export fn imul_signed_width_exec(left: u32, right: u32, width_bits: u32, flags: u32) void {
    const width: u32 = if (width_bits == 16) 16 else 32;
    var product: i64 = 0;
    if (width == 16) {
        product = @as(i64, laneSigned16(left)) * @as(i64, laneSigned16(right));
    } else {
        product = @as(i64, laneSigned32(left)) * @as(i64, laneSigned32(right));
    }
    const product_bits: u64 = @bitCast(product);
    if (width == 16) {
        const low16: u16 = @truncate(product_bits);
        imul_last_result = @as(u32, low16);
    } else {
        const low32: u32 = @truncate(product_bits);
        imul_last_result = low32;
    }
    const overflow = if (width == 16)
        (product < -32768 or product > 32767)
    else
        (product < -2147483648 or product > 2147483647);
    imul_last_flags = flags & ~(FLAG_CF | FLAG_OF);
    if (overflow) {
        imul_last_flags |= FLAG_CF | FLAG_OF;
    }
}

pub export fn get_imul_last_result() u32 {
    return imul_last_result;
}

pub export fn get_imul_last_flags() u32 {
    return imul_last_flags;
}

pub export fn x87_compare_code(left: f64, right: f64) u32 {
    if (std.math.isNan(left) or std.math.isNan(right)) {
        x87_compare_last_code = 3;
        return x87_compare_last_code;
    }
    if (left > right) {
        x87_compare_last_code = 0;
        return x87_compare_last_code;
    }
    if (left < right) {
        x87_compare_last_code = 1;
        return x87_compare_last_code;
    }
    x87_compare_last_code = 2;
    return x87_compare_last_code;
}

pub export fn shift_packed64_exec(lo: u32, hi: u32, count: u32, left_shift: u32) void {
    const value = (@as(u64, hi) << 32) | @as(u64, lo);
    const shifted = if ((left_shift & 1) != 0)
        (if (count >= 64) @as(u64, 0) else (value << @as(u6, @intCast(count))))
    else
        (if (count >= 64) @as(u64, 0) else (value >> @as(u6, @intCast(count))));
    shift_packed64_last_lo = @truncate(shifted);
    shift_packed64_last_hi = @truncate(shifted >> 32);
}

pub export fn get_shift_packed64_last_lo() u32 {
    return shift_packed64_last_lo;
}

pub export fn get_shift_packed64_last_hi() u32 {
    return shift_packed64_last_hi;
}

pub export fn mul_full_width_exec(left: u32, right: u32, width_bits: u32, signed_mul: u32, flags: u32) void {
    const width: u32 = if (width_bits == 16) 16 else 32;
    var overflow = false;
    if ((signed_mul & 1) != 0) {
        const product: i64 = if (width == 16)
            (@as(i64, laneSigned16(left)) * @as(i64, laneSigned16(right)))
        else
            (@as(i64, laneSigned32(left)) * @as(i64, laneSigned32(right)));
        const bits: u64 = @bitCast(product);
        if (width == 16) {
            mul_last_lo = @as(u32, @as(u16, @truncate(bits)));
            mul_last_hi = @as(u32, @as(u16, @truncate(bits >> 16)));
            overflow = product < -32768 or product > 32767;
        } else {
            mul_last_lo = @as(u32, @truncate(bits));
            mul_last_hi = @as(u32, @truncate(bits >> 32));
            overflow = product < -2147483648 or product > 2147483647;
        }
    } else {
        const product: u64 = if (width == 16)
            (@as(u64, left & 0xffff) * @as(u64, right & 0xffff))
        else
            (@as(u64, left) * @as(u64, right));
        if (width == 16) {
            mul_last_lo = @as(u32, @as(u16, @truncate(product)));
            mul_last_hi = @as(u32, @as(u16, @truncate(product >> 16)));
            overflow = product > 0xffff;
        } else {
            mul_last_lo = @as(u32, @truncate(product));
            mul_last_hi = @as(u32, @truncate(product >> 32));
            overflow = product > 0xffffffff;
        }
    }
    mul_last_flags = flags & ~(FLAG_CF | FLAG_OF);
    if (overflow) {
        mul_last_flags |= FLAG_CF | FLAG_OF;
    }
}

pub export fn get_mul_last_lo() u32 {
    return mul_last_lo;
}

pub export fn get_mul_last_hi() u32 {
    return mul_last_hi;
}

pub export fn get_mul_last_flags() u32 {
    return mul_last_flags;
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

pub export fn psubusb32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 4) : (i += 1) {
        const shift = i * 8;
        const av = shr32(a, shift) & 0xff;
        const bv = shr32(b, shift) & 0xff;
        const dv: i32 = @as(i32, @intCast(av)) - @as(i32, @intCast(bv));
        out |= (if (dv < 0) @as(u32, 0) else @as(u32, @intCast(dv))) << shiftCount32(shift);
    }
    return out;
}

pub export fn psubusw32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const shift = i * 16;
        const av = shr32(a, shift) & 0xffff;
        const bv = shr32(b, shift) & 0xffff;
        const dv: i32 = @as(i32, @intCast(av)) - @as(i32, @intCast(bv));
        out |= (if (dv < 0) @as(u32, 0) else @as(u32, @intCast(dv))) << shiftCount32(shift);
    }
    return out;
}

pub export fn pavgb32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 4) : (i += 1) {
        const shift = i * 8;
        const av = shr32(a, shift) & 0xff;
        const bv = shr32(b, shift) & 0xff;
        const avg = (av + bv + 1) >> 1;
        out |= avg << shiftCount32(shift);
    }
    return out;
}

pub export fn paddw32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const shift = i * 16;
        const av = shr32(a, shift) & 0xffff;
        const bv = shr32(b, shift) & 0xffff;
        out |= ((av +% bv) & 0xffff) << shiftCount32(shift);
    }
    return out;
}

pub export fn psubsw32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const shift = i * 16;
        const av = laneSigned16(shr32(a, shift));
        const bv = laneSigned16(shr32(b, shift));
        var result = av - bv;
        if (result > 0x7fff) {
            result = 0x7fff;
        } else if (result < -0x8000) {
            result = -0x8000;
        }
        out |= (@as(u32, @bitCast(result)) & 0xffff) << shiftCount32(shift);
    }
    return out;
}

pub export fn pmullw32(a: u32, b: u32) u32 {
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const shift = i * 16;
        const av = laneSigned16(shr32(a, shift));
        const bv = laneSigned16(shr32(b, shift));
        const product = av * bv;
        out |= (@as(u32, @bitCast(product)) & 0xffff) << shiftCount32(shift);
    }
    return out;
}

pub export fn psrlw32(a: u32, count: u32) u32 {
    const shift = if (count >= 16) @as(u32, 16) else (count & 0xff);
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const lane_shift = i * 16;
        const value = shr32(a, lane_shift) & 0xffff;
        const result = if (shift >= 16) @as(u32, 0) else shr32(value, shift);
        out |= (result & 0xffff) << shiftCount32(lane_shift);
    }
    return out;
}

pub export fn psraw32(a: u32, count: u32) u32 {
    const shift = if (count >= 16) @as(u32, 16) else (count & 0xff);
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const lane_shift = i * 16;
        const value = laneSigned16(shr32(a, lane_shift));
        const result: i32 = if (shift >= 16) (if (value < 0) -1 else 0) else (value >> shiftCount32(shift));
        out |= (@as(u32, @bitCast(result)) & 0xffff) << shiftCount32(lane_shift);
    }
    return out;
}

pub export fn psllw32(a: u32, count: u32) u32 {
    const shift = if (count >= 16) @as(u32, 16) else (count & 0xff);
    var out: u32 = 0;
    var i: u32 = 0;
    while (i < 2) : (i += 1) {
        const lane_shift = i * 16;
        const value = shr32(a, lane_shift) & 0xffff;
        const result = if (shift >= 16) @as(u32, 0) else (shl32(value, shift) & 0xffff);
        out |= result << shiftCount32(lane_shift);
    }
    return out;
}

pub export fn psrld32(a: u32, count: u32) u32 {
    const shift = if (count >= 32) @as(u32, 32) else (count & 0xff);
    return if (shift >= 32) @as(u32, 0) else shr32(a, shift);
}

pub export fn psrad32(a: u32, count: u32) u32 {
    const shift = if (count >= 32) @as(u32, 32) else (count & 0xff);
    const value = laneSigned32(a);
    return if (shift >= 32)
        (if (value < 0) 0xffffffff else @as(u32, 0))
    else
        @bitCast(value >> shiftCount32(shift));
}

pub export fn pslld32(a: u32, count: u32) u32 {
    const shift = if (count >= 32) @as(u32, 32) else (count & 0xff);
    return if (shift >= 32) @as(u32, 0) else shl32(a, shift);
}

pub export fn packsswb64_exec(dst_lo: u32, dst_hi: u32, src_lo: u32, src_hi: u32) void {
    const out0 = clampSigned8From16(dst_lo & 0xffff);
    const out1 = clampSigned8From16(shr32(dst_lo, 16));
    const out2 = clampSigned8From16(dst_hi & 0xffff);
    const out3 = clampSigned8From16(shr32(dst_hi, 16));
    const out4 = clampSigned8From16(src_lo & 0xffff);
    const out5 = clampSigned8From16(shr32(src_lo, 16));
    const out6 = clampSigned8From16(src_hi & 0xffff);
    const out7 = clampSigned8From16(shr32(src_hi, 16));
    setPacked64(
        out0 | shl32(out1, 8) | shl32(out2, 16) | shl32(out3, 24),
        out4 | shl32(out5, 8) | shl32(out6, 16) | shl32(out7, 24),
    );
}

pub export fn packuswb64_exec(dst_lo: u32, dst_hi: u32, src_lo: u32, src_hi: u32) void {
    const out0 = clampUnsigned8From16(dst_lo & 0xffff);
    const out1 = clampUnsigned8From16(shr32(dst_lo, 16));
    const out2 = clampUnsigned8From16(dst_hi & 0xffff);
    const out3 = clampUnsigned8From16(shr32(dst_hi, 16));
    const out4 = clampUnsigned8From16(src_lo & 0xffff);
    const out5 = clampUnsigned8From16(shr32(src_lo, 16));
    const out6 = clampUnsigned8From16(src_hi & 0xffff);
    const out7 = clampUnsigned8From16(shr32(src_hi, 16));
    setPacked64(
        out0 | shl32(out1, 8) | shl32(out2, 16) | shl32(out3, 24),
        out4 | shl32(out5, 8) | shl32(out6, 16) | shl32(out7, 24),
    );
}

pub export fn packssdw64_exec(dst_lo: u32, dst_hi: u32, src_lo: u32, src_hi: u32) void {
    setPacked64(
        clampSigned16From32(dst_lo) | shl32(clampSigned16From32(dst_hi), 16),
        clampSigned16From32(src_lo) | shl32(clampSigned16From32(src_hi), 16),
    );
}

pub export fn punpcklbw64_exec(dst_lo: u32, src_lo: u32) void {
    var out_lo: u32 = 0;
    var out_hi: u32 = 0;
    var i: u32 = 0;
    while (i < 4) : (i += 1) {
        const dst_byte = shr32(dst_lo, i * 8) & 0xff;
        const src_byte = shr32(src_lo, i * 8) & 0xff;
        const shift = (i & 1) * 16;
        if (i < 2) {
            out_lo |= shl32(dst_byte, shift);
            out_lo |= shl32(src_byte, shift + 8);
        } else {
            out_hi |= shl32(dst_byte, shift);
            out_hi |= shl32(src_byte, shift + 8);
        }
    }
    setPacked64(out_lo, out_hi);
}

pub export fn punpckhbw64_exec(dst_hi: u32, src_hi: u32) void {
    var out_lo: u32 = 0;
    var out_hi_out: u32 = 0;
    var i: u32 = 0;
    while (i < 4) : (i += 1) {
        const dst_byte = shr32(dst_hi, i * 8) & 0xff;
        const src_byte = shr32(src_hi, i * 8) & 0xff;
        const shift = (i & 1) * 16;
        if (i < 2) {
            out_lo |= shl32(dst_byte, shift);
            out_lo |= shl32(src_byte, shift + 8);
        } else {
            out_hi_out |= shl32(dst_byte, shift);
            out_hi_out |= shl32(src_byte, shift + 8);
        }
    }
    setPacked64(out_lo, out_hi_out);
}

pub export fn punpcklwd64_exec(dst_lo: u32, src_lo: u32) void {
    const d0 = dst_lo & 0xffff;
    const d1 = shr32(dst_lo, 16) & 0xffff;
    const s0 = src_lo & 0xffff;
    const s1 = shr32(src_lo, 16) & 0xffff;
    setPacked64(
        d0 | shl32(s0, 16),
        d1 | shl32(s1, 16),
    );
}

pub export fn punpckhwd64_exec(dst_hi: u32, src_hi: u32) void {
    const d0 = dst_hi & 0xffff;
    const d1 = shr32(dst_hi, 16) & 0xffff;
    const s0 = src_hi & 0xffff;
    const s1 = shr32(src_hi, 16) & 0xffff;
    setPacked64(
        d0 | shl32(s0, 16),
        d1 | shl32(s1, 16),
    );
}

pub export fn get_packed64_last_lo() u32 {
    return packed64_last_lo;
}

pub export fn get_packed64_last_hi() u32 {
    return packed64_last_hi;
}
