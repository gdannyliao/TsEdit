import { v4 as uuidv4 } from 'uuid';
for (var Base64KeyChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", AsciiTo64 = new Array(128), i = 0; i < 128; ++i) AsciiTo64[i] = 0;
for (i = 0; i < 64; ++i) AsciiTo64[Base64KeyChars.charCodeAt(i)] = i;
var Reg_Dash = /-/g,
    Reg_Uuid = /^[0-9a-fA-F-]{36}$/,
    Reg_NormalizedUuid = /^[0-9a-fA-F]{32}$/,
    Reg_CompressedUuid = /^[0-9a-zA-Z+/]{22,23}$/,
    UuidUtils = {
        NonUuidMark: ".",
        compressUuid: function (i, e) {
            if (Reg_Uuid.test(i)) i = i.replace(Reg_Dash, "");
            else if (!Reg_NormalizedUuid.test(i)) return i;
            var s = !0 === e ? 2 : 5;
            return UuidUtils.compressHex(i, s)
        },
        compressHex: function (i, e) {
            var s, r = i.length;
            s = void 0 !== e ? e : r % 3;
            for (var t = i.slice(0, s), o:string[] = []; s < r;) {
                var u = parseInt(i[s], 16),
                    d = parseInt(i[s + 1], 16),
                    n = parseInt(i[s + 2], 16);
                o.push(Base64KeyChars[u << 2 | d >> 2]), o.push(Base64KeyChars[(3 & d) << 4 | n]), s += 3
            }
            return t + o.join("")
        },
        decompressUuid: function (i) {
            if (23 === i.length) {
                for (var e:string[] = [], s = 5; s < 23; s += 2) {
                    var r = AsciiTo64[i.charCodeAt(s)],
                        t = AsciiTo64[i.charCodeAt(s + 1)];
                    e.push((r >> 2).toString(16)), e.push(((3 & r) << 2 | t >> 4).toString(16)), e.push((15 & t).toString(16))
                }
                i = i.slice(0, 5) + e.join("")
            } else if (22 === i.length) {
                for (e = [], s = 2; s < 22; s += 2) {
                    r = AsciiTo64[i.charCodeAt(s)], t = AsciiTo64[i.charCodeAt(s + 1)];
                    e.push((r >> 2).toString(16)), e.push(((3 & r) << 2 | t >> 4).toString(16)), e.push((15 & t).toString(16))
                }
                i = i.slice(0, 2) + e.join("")
            }
            return [i.slice(0, 8), i.slice(8, 12), i.slice(12, 16), i.slice(16, 20), i.slice(20)].join("-")
        },
        isUuid: function (i) {
            return Reg_CompressedUuid.test(i) || Reg_NormalizedUuid.test(i) || Reg_Uuid.test(i)
        },
        uuid: function () {
            var i = uuidv4()
            return UuidUtils.compressUuid(i, !0)
        }
    };

export {UuidUtils}
