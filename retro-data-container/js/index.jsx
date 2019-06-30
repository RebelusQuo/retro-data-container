const read_file = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => {
            reader.abort();
            reject(new DOMException("Error parsing file"));
        };
        reader.onload = (e) => { resolve(new Uint8Array(e.target.result)); };
        reader.readAsArrayBuffer(file);
    });
};

const fetch_file = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

const apply_ips = (rom, patch) => {
    const big = false;
    const header = 5;
    const footer = 3;
    let offset = header;
    const view = new DataView(patch.buffer);
    while (offset + footer < patch.length) {
        const dest = (patch[offset] << 16) + view.getUint16(offset + 1, big);
        const length = view.getUint16(offset + 3, big);
        offset += 5;
        if (length > 0) {
            rom.set(patch.slice(offset, offset + length), dest);
            offset += length;
        } else {
            const rle_length = view.getUint16(offset, big);
            const rle_byte = patch[offset + 2];
            rom.set(Uint8Array.from(new Array(rle_length), () => rle_byte), dest);
            offset += 3;
        }
    }

    return rom;
};

// [[rom addresses], length, entries = 1, entry offset = 0]
const sm_sprite_loader_offsets = [0x0,0x24,0x4F,0x73,0x9E,0xC2,0xED,0x111,0x139];
const sm_sprite_manifest = [
    // DMA banks
    [[0xE0000], 0x7D80],        // DMA bank 1
    [[0xE8000], 0x7E00],        // DMA bank 2
    [[0xF0000], 0x7D80],        // DMA bank 3
    [[0xF8000], 0x7F00],        // DMA bank 4
    [[0x3A8000], 0x7EC0],       // DMA bank 5
    [[0x3B0000], 0x7E80],       // DMA bank 6
    [[0x3B8000], 0x7F80],       // DMA bank 7
    [[0x3C0000], 0x8000],       // DMA bank 8
    [[0x3C8000], 0x8000],       // DMA bank 9
    [[0x3D0000], 0x7F00],       // DMA bank 10
    [[0x3D8000], 0x7F00],       // DMA bank 11
    [[0x3E0000], 0x7F00],       // DMA bank 12
    [[0x3E8000], 0x7D40],       // DMA bank 13
    [[0x3F0000], 0x7D80],       // DMA bank 14
    [[0xD8200], 0xC00],         // DMA bank 15
    // Death sprite poses
    [[0x3F8000], 0x4000],       // Death left
    [[0x3FC000], 0x4000],       // Death right
    // Other sprite data
    [[0xD1A00], 0x3C0],         // Gun port data
    [[0x1B5A00], 0x600],        // File select sprites
    [[0x1B5900], 0x20],         // File select missile
    [[0x1B5980], 0x20],         // File select missile head
    // Palettes
    [[0xD9402], 30],            // Power Standard
    [[0xD9522], 30],            // Varia Standard
    [[0xD9802], 30],            // Gravity Standard
    [[0x6DB6D], 30, 9, sm_sprite_loader_offsets], // Power Loader
    [[0x6DCD3], 30, 9, sm_sprite_loader_offsets], // Varia Loader
    [[0x6DE39], 30, 9, sm_sprite_loader_offsets], // Gravity Loader
    [[0x6E468], 30, 16, 0x22],  // Power Heat
    [[0x6E694], 30, 16, 0x22],  // Varia Heat
    [[0x6E8C0], 30, 16, 0x22],  // Gravity Heat
    [[0xD9822], 30, 8, 0x20],   // Power Charge
    [[0xD9922], 30, 8, 0x20],   // Varia Charge
    [[0xD9A22], 30, 8, 0x20],   // Gravity Charge
    [[0xD9B22], 30, 4, 0x20],   // Power Speed boost
    [[0xD9D22], 30, 4, 0x20],   // Varia Speed boost
    [[0xD9F22], 30, 4, 0x20],   // Gravity Speed boost
    [[0xD9BA2], 30, 4, 0x20],   // Power Speed squat
    [[0xD9DA2], 30, 4, 0x20],   // Varia Speed squat
    [[0xD9FA2], 30, 4, 0x20],   // Gravity Speed squat
    [[0xD9C22], 30, 4, 0x20],   // Power Shinespark
    [[0xD9E22], 30, 4, 0x20],   // Varia Shinespark
    [[0xDA022], 30, 4, 0x20],   // Gravity Shinespark
    [[0xD9CA2], 30, 4, 0x20],   // Power Screw attack
    [[0xD9EA2], 30, 4, 0x20],   // Varia Screw attack
    [[0xDA0A2], 30, 4, 0x20],   // Gravity Screw attack
    [[0xD96C2], 30, 6, 0x20],   // Crystal flash
    [[0xDA122], 30, 9, 0x20],   // Death
    [[0xDA242], 30, 10, 0x20],  // Hyper beam
    [[0xDA3A2, 0x6656B], 30],   // Sepia
    [[0xDA382], 30],            // Sepia hurt
    [[0xDA3C6], 6],             // Xray
    [[0x1652C], 2],             // Door Visor
    [[0x765E2], 30],            // File select
    [[0x6668B], 30],            // Ship Intro
    [[0x6D6C2], 30, 16, 0x24],  // Ship Outro
    [[0x1125A0], 28],           // Ship Standard
    [[0x6CA54], 2, 14, 0x6],    // Ship Glow
];

const apply_rdc = (rom, rdc) => {
    const little = true;
    const utf8 = new TextDecoder();
    const version = 0x01;
    if (utf8.decode(rdc.slice(0, 18)) !== 'RETRODATACONTAINER')
        throw new Error("Could not find the RDC format header");
    if (rdc[18] !== version)
        throw new Error(`RDC version ${rdc[18]} is not supported, expected version ${version}`)

    let offset = 19;
    let block;
    let view = new DataView(rdc.buffer);
    const sm_sprite_type = 4;
    let blocks = view.getUint32(offset, little);
    while (blocks > 0) {
        blocks -= 1;
        if (view.getUint32(offset += 4, little) === sm_sprite_type)
            block = view.getUint32(offset += 4, little);
        offset += 4;
        if (block) {
            offset += blocks * 8;
            break;
        }
    }
    if (block == null)
        throw new Error("The RDC file did not contain the SM player sprite data block");

    let field = new Uint8Array(rdc.buffer, offset);
    let end = field.findIndex(x => x === 0);
    if (end < 0)
        throw new Error("Missing null terminator for the Author data field");
    const author = utf8.decode(field.slice(0, end));

    offset = 0;
    block = new Uint8Array(rdc.buffer, block);
    for (const [addrs, length, n = 1, k = 0] of sm_sprite_manifest) {
        for (const addr of addrs) {
            for (let i = 0; i < n; i += 1) {
                const dest = addr + (k[0] == null ? k*i : k[i]);
                const src = offset + length * i;
                rom.set(block.slice(src, src + length), dest);
            }
        }
        offset += length * n;
    }

    return [author, rom];
};

const { useState, useRef } = React;

const Button = (props) => <button type="button" {...props} />;

const App = () => {
    const file_SM = useRef(null);
    const file_rdc = useRef(null);
    const [author, setAuthor] = useState('');

    const filename_without_ext = (rdc_name) => rdc_name.match(/^[^\.]+/)[0];
    const filename_with_suffix = (name, suffix) => name.replace(/(\.[^\.]+)$/, ` - ${suffix}$1`);

    const apply_sprite = async () => {
        const rom_file = file_SM.current.files[0];
        const rdc_file = file_rdc.current.files[0];

        let rom = new Uint8Array(0x400000);
        rom.set(await read_file(rom_file));

        rom = apply_ips(rom, await fetch_file("../sm_samus_sprite.ips"));

        // Todo: make use of the author field
        if (rdc_file) [,rom] = apply_rdc(rom, await read_file(rdc_file));

        const suffix = rdc_file ? filename_without_ext(rdc_file.name) : 'samus';
        const filename = filename_with_suffix(rom_file.name, suffix);
        saveAs(new Blob([rom]), filename);
    };

    const clear_rdc = () => {
        file_rdc.current.value = null;
    };

    return <React.Fragment>
      <div>SM Rom: <input type="file" ref={file_SM} /></div>
      <div>Sprite RDC file <input type="file" ref={file_rdc} /><Button onClick={clear_rdc}>X</Button></div>
      <div><Button onClick={apply_sprite}>Apply sprite</Button></div>
    </React.Fragment>;
};

ReactDOM.render(<App />, document.getElementById('app'));
