(function () {
  'use strict';

  // Stardew-inspired cozy cottage & garden courtyard palettes for Day / Dusk / Night.
  const PALETTES = {
    day: {
      id: 'day',
      label: '晴昼',
      sky: ['#6cb9f0', '#87ccf5', '#addff9', '#d8f1fc'],
      cloudMain: '#fffdf7',
      cloudShade: '#dcecf7',
      hillFar: '#72b095',
      hillNear: '#589c6e',
      grass: ['#67ad51', '#73ba59', '#5ca148', '#83c963'],
      grassDetail: '#4d8a3f',
      soil: '#9c7149',
      soilDark: '#785233',
      stoneLight: '#d8d2c5',
      stoneMid: '#b5aea0',
      stoneDark: '#827b70',
      roofTop: '#c45b47',
      roofMid: '#a84738',
      roofDark: '#7c3028',
      roofRim: '#e08164',
      timber: '#6e452b',
      timberLight: '#915f3b',
      timberDark: '#472b1a',
      wallPlaster: '#f3e5c8',
      wallPlasterShade: '#e4d1ad',
      wainscot: '#c7925b',
      wainscotLight: '#dca972',
      wainscotDark: '#996a3c',
      floor: ['#c98f55', '#bf854d', '#d29a60', '#b57b45'],
      floorLine: '#8f5d32',
      floorAO: 'rgba(62, 34, 16, 0.24)',
      rugOuter: '#9e4747',
      rugMid: '#d99b66',
      rugInner: '#f0dec0',
      rugPattern: '#5f8769',
      porch: ['#b58355', '#a67549', '#c49162'],
      pondRim: '#8d877a',
      pondWater: '#3e92b5',
      pondDeep: '#2c7194',
      pondSparkle: '#b8ecfa',
      treeLeaves: ['#397a3e', '#4d984c', '#6bb85c', '#92d170'],
      sakuraLeaves: ['#c96387', '#e588a8', '#f6b3ca', '#ffe0eb'],
      sunBeam: 'rgba(255, 245, 195, 0.16)',
      ambientTint: null,
      lampGlow: 0.22,
      windowGlass: '#9cdaf7',
      curtain: '#e8938b',
      curtainShade: '#c46f6a',
      fence: '#f5eedc',
      fenceShade: '#cfc3ab',
    },
    dusk: {
      id: 'dusk',
      label: '暮色',
      sky: ['#493d75', '#874c78', '#cf6e68', '#f5a96b'],
      cloudMain: '#ffd5a8',
      cloudShade: '#cc7c78',
      hillFar: '#59486b',
      hillNear: '#475952',
      grass: ['#4e7b49', '#5a8850', '#426b3f', '#6b9454'],
      grassDetail: '#355734',
      soil: '#7e553b',
      soilDark: '#5b3b28',
      stoneLight: '#c4b1a3',
      stoneMid: '#9a897e',
      stoneDark: '#6b5e59',
      roofTop: '#9e453e',
      roofMid: '#823432',
      roofDark: '#5c2225',
      roofRim: '#cf745b',
      timber: '#593524',
      timberLight: '#7a4b32',
      timberDark: '#381f15',
      wallPlaster: '#e6c9a5',
      wallPlasterShade: '#d1af88',
      wainscot: '#a87246',
      wainscotLight: '#c28858',
      wainscotDark: '#7d4f2e',
      floor: ['#b37645', '#a66b3d', '#be814d', '#996036'],
      floorLine: '#734525',
      floorAO: 'rgba(42, 20, 14, 0.30)',
      rugOuter: '#873942',
      rugMid: '#c48152',
      rugInner: '#e0c5a4',
      rugPattern: '#4c6e5c',
      porch: ['#996945', '#8a5d3c', '#a8764f'],
      pondRim: '#756867',
      pondWater: '#3c6b8f',
      pondDeep: '#2a4d6e',
      pondSparkle: '#f7c192',
      treeLeaves: ['#2d5e3b', '#3f7847', '#589451', '#82ad5a'],
      sakuraLeaves: ['#9e466e', '#c46489', '#e691ab', '#ffc2ce'],
      sunBeam: 'rgba(255, 184, 108, 0.20)',
      ambientTint: 'rgba(92, 42, 64, 0.12)',
      lampGlow: 0.52,
      windowGlass: '#e89674',
      curtain: '#d97e7c',
      curtainShade: '#ab595d',
      fence: '#e0ccb8',
      fenceShade: '#b39d89',
    },
    night: {
      id: 'night',
      label: '星夜',
      sky: ['#141833', '#1c244a', '#263463', '#35487a'],
      cloudMain: '#475987',
      cloudShade: '#2c395e',
      hillFar: '#222d4f',
      hillNear: '#1e3342',
      grass: ['#26473d', '#2e5445', '#1f3b34', '#38634f'],
      grassDetail: '#18302a',
      soil: '#4e3932',
      soilDark: '#362622',
      stoneLight: '#808899',
      stoneMid: '#61687a',
      stoneDark: '#424757',
      roofTop: '#5e3545',
      roofMid: '#4a2838',
      roofDark: '#331a29',
      roofRim: '#7d4a59',
      timber: '#452c26',
      timberLight: '#613f34',
      timberDark: '#291917',
      wallPlaster: '#c9b498',
      wallPlasterShade: '#b0987c',
      wainscot: '#8a5d3d',
      wainscotLight: '#a3714d',
      wainscotDark: '#633f28',
      floor: ['#8f5f3c', '#825535', '#9c6842', '#754b2e'],
      floorLine: '#59361f',
      floorAO: 'rgba(18, 12, 24, 0.36)',
      rugOuter: '#6e313d',
      rugMid: '#a36b49',
      rugInner: '#c4ab91',
      rugPattern: '#3d5e54',
      porch: ['#6b4d3e', '#5e4235', '#785746'],
      pondRim: '#4d5463',
      pondWater: '#224769',
      pondDeep: '#16314d',
      pondSparkle: '#99d4ff',
      treeLeaves: ['#1a3b36', '#244d43', '#316351', '#457a61'],
      sakuraLeaves: ['#5e3357', '#7d4670', '#a66590', '#cc8fb4'],
      sunBeam: 'rgba(162, 198, 255, 0.12)',
      ambientTint: 'rgba(18, 24, 58, 0.22)',
      lampGlow: 0.82,
      windowGlass: '#24325c',
      curtain: '#a66370',
      curtainShade: '#7d4554',
      fence: '#9aa4b5',
      fenceShade: '#6e778a',
    },
  };

  // Exact pixel coordinates shared across background, furniture, motion, and hit-testing.
  const LAYOUT = {
    width: 640,
    height: 360,
    cottage: { left: 16, right: 468, top: 62, floorTop: 130, bottom: 340 },
    doorway: { x: 466, top: 168, bottom: 234, centerY: 208 },
    station: { x: 248, y: 186, laneX: 182 },
    desks3: [
      { position: 'desk-1', endpoint: 'antigravity', sprite: 'gemini', x: 116, deskY: 278, laneX: 182, accent: '#a87ffb' },
      { position: 'desk-2', endpoint: 'qoder', sprite: 'qwen', x: 248, deskY: 278, laneX: 314, accent: '#6fb3f2' },
      { position: 'desk-3', endpoint: 'workbuddy_desktop', sprite: 'hy', x: 380, deskY: 278, laneX: 442, accent: '#e87979' },
    ],
    desks4: [
      { position: 'desk-1', endpoint: 'doubao_desktop', sprite: 'orange', x: 90, deskY: 278, laneX: 142, accent: '#e8965a' },
      { position: 'desk-2', endpoint: 'qoder', sprite: 'qwen', x: 194, deskY: 278, laneX: 246, accent: '#75b2d6' },
      { position: 'desk-3', endpoint: 'codebuddy', sprite: 'dayu', x: 298, deskY: 278, laneX: 350, accent: '#6ac4de' },
      { position: 'desk-4', endpoint: 'dsh', sprite: 'gemini', x: 402, deskY: 278, laneX: 446, accent: '#c993e8' },
    ],
    props: {
      hearth: { x: 150, y: 74, w: 52, h: 58, label: '壁炉', hint: '点击开关壁炉暖火' },
      cat: { x: 162, y: 134, w: 28, h: 20, label: '小橘猫', hint: '点击抚摸小橘猫' },
      tea: { x: 20, y: 146, w: 36, h: 62, label: '茶水曲奇吧', hint: '点击现泡热茶并招呼大家来喝茶' },
      music: { x: 424, y: 66, w: 34, h: 26, label: '复古留声机', hint: '点击切换悠闲背景音符' },
      board: { x: 216, y: 72, w: 78, h: 40, label: '工坊公告板', hint: '点击查看当前工位速览' },
      pond: { x: 528, y: 160, w: 98, h: 62, label: '庭院锦鲤池', hint: '点击给锦鲤投食看水波' },
      tree: { x: 524, y: 36, w: 102, h: 106, label: '庭院樱花树', hint: '点击摇落一阵花瓣雨' },
      plushie: { x: 24, y: 268, w: 34, h: 38, label: '蓝鲸抱枕沙发', hint: '点击捏捏大肥鱼抱枕' },
    },
  };

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function hash(x, y) {
    let n = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  function resolvePalette(timeMode) {
    if (timeMode && PALETTES[timeMode]) return PALETTES[timeMode];
    // Auto mode: follow active UI theme first if explicitly set, else local clock.
    const theme = document.documentElement?.dataset?.theme;
    if (theme === 'daylight') return PALETTES.day;
    if (theme === 'dusk') return PALETTES.dusk;
    if (theme === 'night') return PALETTES.night;
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 17) return PALETTES.day;
    if (hour >= 17 && hour < 20) return PALETTES.dusk;
    return PALETTES.night;
  }

  // Draw crisp pixel bitmap from ASCII rows.
  function drawBitmap(ctx, x, y, rows, map, scale = 1) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const color = map[ch];
        if (color) px(ctx, x + c * scale, y + r * scale, scale, scale, color);
      }
    }
  }

  function drawSkyAndHorizon(ctx, pal, width) {
    const bands = [14, 16, 16, 20];
    let y = 0;
    for (let i = 0; i < pal.sky.length; i++) {
      px(ctx, 0, y, width, bands[i], pal.sky[i]);
      // Subtle pixel dither strip between sky bands
      if (i < pal.sky.length - 1) {
        for (let x = 0; x < width; x += 2) {
          px(ctx, x + (i % 2), y + bands[i] - 1, 1, 1, pal.sky[i + 1]);
        }
      }
      y += bands[i];
    }
    // Far rolling Stardew mountains/hills
    for (let x = 0; x < width; x += 2) {
      const h1 = Math.round(14 + Math.sin(x * 0.017 + 0.6) * 7 + Math.cos(x * 0.041) * 3);
      px(ctx, x, 66 - h1, 2, h1, pal.hillFar);
      const h2 = Math.round(9 + Math.sin(x * 0.029 + 2.1) * 4 + Math.cos(x * 0.06) * 2);
      px(ctx, x, 66 - h2, 2, h2, pal.hillNear);
    }
    // Distant pine silhouettes on the right horizon
    for (const tx of [482, 496, 512, 616, 628]) {
      px(ctx, tx + 2, 46, 2, 14, pal.timberDark);
      px(ctx, tx + 2, 38, 2, 3, pal.treeLeaves[0]);
      px(ctx, tx + 1, 41, 4, 4, pal.treeLeaves[0]);
      px(ctx, tx, 45, 6, 5, pal.treeLeaves[1]);
      px(ctx, tx - 1, 50, 8, 4, pal.treeLeaves[0]);
    }
  }

  function drawMeadow(ctx, pal, width, height) {
    px(ctx, 0, 62, width, height - 62, pal.grass[0]);
    // Textured Stardew grass tiles with subtle tufts & clover
    for (let gy = 64; gy < height; gy += 8) {
      for (let gx = 0; gx < width; gx += 8) {
        // Skip interior cottage floor to save draw work
        if (gx >= 20 && gx <= 460 && gy >= 68 && gy <= 334) continue;
        const r = hash(gx, gy);
        if (r > 0.65) px(ctx, gx, gy, 8, 8, pal.grass[1]);
        else if (r < 0.2) px(ctx, gx, gy, 8, 8, pal.grass[2]);
        // Cute pixel grass blades
        if (r > 0.42 && r < 0.56) {
          px(ctx, gx + 2, gy + 4, 1, 2, pal.grassDetail);
          px(ctx, gx + 4, gy + 3, 1, 3, pal.grass[3]);
          px(ctx, gx + 6, gy + 5, 1, 1, pal.grassDetail);
        }
        // Occasional tiny daisy speck
        if (r > 0.93 && (gx > 476 || gy > 344)) {
          px(ctx, gx + 3, gy + 3, 2, 2, '#fff7dc');
          px(ctx, gx + 4, gy + 4, 1, 1, '#f2c14e');
        }
      }
    }
  }

  function drawFlower(ctx, x, y, petal, center = '#ffe066', stem = '#3f8243') {
    px(ctx, x + 2, y + 4, 1, 4, stem);
    px(ctx, x + 1, y + 6, 1, 1, '#5ca856');
    px(ctx, x + 3, y + 5, 1, 1, '#5ca856');
    px(ctx, x + 1, y + 1, 3, 3, petal);
    px(ctx, x + 2, y, 1, 1, petal);
    px(ctx, x, y + 2, 1, 1, petal);
    px(ctx, x + 4, y + 2, 1, 1, petal);
    px(ctx, x + 2, y + 2, 1, 1, center);
  }

  function drawBush(ctx, x, y, w, h, pal) {
    px(ctx, x + 2, y + h - 2, w - 4, 4, 'rgba(20, 32, 22, 0.25)');
    px(ctx, x + 2, y + 2, w - 4, h - 2, pal.treeLeaves[0]);
    px(ctx, x, y + 4, w, h - 5, pal.treeLeaves[1]);
    px(ctx, x + 3, y + 1, w - 6, h - 4, pal.treeLeaves[2]);
    px(ctx, x + 5, y + 2, Math.max(4, w - 12), 4, pal.treeLeaves[3]);
    // Little pink blossoms on bush
    px(ctx, x + 5, y + 5, 2, 2, '#f7b2c4');
    px(ctx, x + w - 8, y + 7, 2, 2, '#ffe899');
  }

  function drawGardenStatic(ctx, pal) {
    // 1. Stone stepping path from porch into garden & around pond
    const stones = [
      [518, 206, 12, 8], [520, 220, 11, 8], [517, 234, 13, 9],
      [530, 245, 14, 9], [546, 250, 14, 9], [548, 266, 13, 9],
      [544, 282, 14, 9], [536, 297, 15, 9], [518, 304, 14, 9],
      [498, 306, 15, 9], [482, 304, 13, 9],
    ];
    for (const [sx, sy, sw, sh] of stones) {
      px(ctx, sx + 1, sy + 1, sw, sh, pal.grassDetail);
      px(ctx, sx + 1, sy, sw - 2, sh, pal.stoneMid);
      px(ctx, sx, sy + 1, sw, sh - 2, pal.stoneMid);
      px(ctx, sx + 2, sy + 1, sw - 4, 2, pal.stoneLight);
      px(ctx, sx + 2, sy + sh - 2, sw - 4, 1, pal.stoneDark);
    }

    // 2. Koi Pond Basin (right-middle yard: x 528..626, y 160..220)
    px(ctx, 534, 158, 84, 64, pal.pondRim);
    px(ctx, 528, 166, 98, 48, pal.pondRim);
    px(ctx, 530, 162, 94, 56, pal.stoneLight);
    px(ctx, 534, 164, 86, 52, pal.pondDeep);
    px(ctx, 537, 167, 80, 45, pal.pondWater);
    // Pond rim stones
    const rimStones = [
      [530, 162, 10, 6], [546, 158, 12, 6], [570, 157, 14, 6], [596, 159, 12, 6],
      [614, 166, 10, 8], [616, 190, 10, 10], [598, 212, 14, 7], [568, 214, 16, 7],
      [538, 211, 14, 7], [527, 186, 8, 10],
    ];
    for (const [rx, ry, rw, rh] of rimStones) {
      px(ctx, rx, ry, rw, rh, pal.stoneDark);
      px(ctx, rx + 1, ry, rw - 2, rh - 1, pal.stoneMid);
      px(ctx, rx + 2, ry + 1, rw - 4, 2, pal.stoneLight);
    }
    // Pond reeds on right bank
    for (const [rx, ry] of [[618, 152], [622, 156], [625, 160], [532, 150]]) {
      px(ctx, rx, ry, 1, 12, '#3d7d43');
      px(ctx, rx + 1, ry + 3, 1, 9, '#5ca856');
      px(ctx, rx - 1, ry + 1, 3, 3, '#7a4f34'); // cattail head
    }

    // 3. Wooden Porch Deck (attached to right doorway: x 468..516, y 160..248)
    px(ctx, 470, 246, 48, 5, 'rgba(20, 24, 18, 0.30)');
    for (let py = 162; py < 246; py += 6) {
      px(ctx, 469, py, 46, 6, pal.porch[(py / 6) % 3]);
      px(ctx, 469, py + 5, 46, 1, pal.timberDark);
      px(ctx, 471, py + 1, 42, 1, 'rgba(255, 240, 210, 0.14)');
    }
    // Porch railings top & bottom
    px(ctx, 469, 158, 48, 5, pal.timberLight);
    px(ctx, 469, 162, 48, 2, pal.timberDark);
    for (let rx = 474; rx <= 512; rx += 12) px(ctx, rx, 154, 4, 10, pal.timber);
    px(ctx, 469, 242, 48, 5, pal.timberLight);
    px(ctx, 469, 246, 48, 2, pal.timberDark);
    for (let rx = 474; rx <= 512; rx += 12) px(ctx, rx, 238, 4, 10, pal.timber);
    // Porch wooden step down to stone path
    px(ctx, 515, 198, 7, 22, pal.timberLight);
    px(ctx, 515, 219, 7, 2, pal.timberDark);
    px(ctx, 521, 198, 2, 22, pal.timberDark);
    // Woven welcome mat outside doorway
    px(ctx, 474, 194, 18, 22, '#9e6840');
    px(ctx, 476, 196, 14, 18, '#c9935d');
    px(ctx, 478, 198, 10, 14, '#e3bc86');
    px(ctx, 481, 203, 4, 4, '#9e4747');

    // 4. Garden Lantern Post (x 514, y 226..266)
    px(ctx, 511, 263, 10, 4, pal.stoneDark);
    px(ctx, 512, 261, 8, 3, pal.stoneMid);
    px(ctx, 515, 232, 2, 30, '#36323d');
    px(ctx, 512, 231, 8, 2, '#36323d');
    px(ctx, 513, 224, 6, 7, '#ffe394');
    px(ctx, 512, 222, 8, 2, '#36323d');
    px(ctx, 514, 220, 4, 2, '#36323d');

    // 5. Wooden Garden Bench (x 568..620, y 266..294)
    px(ctx, 570, 291, 48, 4, 'rgba(20, 32, 22, 0.28)');
    px(ctx, 570, 266, 48, 12, pal.timber);
    px(ctx, 571, 268, 46, 3, pal.wainscotLight);
    px(ctx, 571, 273, 46, 3, pal.wainscot);
    px(ctx, 568, 279, 52, 7, pal.wainscotLight);
    px(ctx, 568, 284, 52, 2, pal.timberDark);
    px(ctx, 571, 286, 4, 7, '#3b323b');
    px(ctx, 613, 286, 4, 7, '#3b323b');

    // 6. Flowerbed, Watering Can & Stardew Picket Fence (bottom right)
    // Rich dark soil bed
    px(ctx, 482, 318, 148, 16, pal.soilDark);
    px(ctx, 484, 320, 144, 12, pal.soil);
    const flowerSpec = [
      [488, 316, '#eb6565'], [498, 319, '#ffd257'], [508, 315, '#b689f5'],
      [520, 318, '#ff92b4'], [532, 316, '#ffd257'], [544, 319, '#eb6565'],
      [558, 316, '#87c5ff'], [570, 318, '#ff92b4'], [584, 315, '#ffd257'],
      [596, 319, '#eb6565'], [608, 316, '#b689f5'], [619, 318, '#ffd257'],
    ];
    for (const [fx, fy, col] of flowerSpec) drawFlower(ctx, fx, fy, col);

    // Cute blue watering can near flowerbed
    px(ctx, 588, 302, 10, 8, '#5b92c4');
    px(ctx, 590, 304, 6, 4, '#84b8e6');
    px(ctx, 584, 304, 4, 2, '#5b92c4');
    px(ctx, 582, 302, 3, 2, '#a3d1f7');
    px(ctx, 598, 303, 3, 5, '#4674a1');

    // Classic cream Stardew Picket Fence along bottom edge
    px(ctx, 476, 336, 158, 3, pal.fenceShade);
    px(ctx, 476, 344, 158, 3, pal.fenceShade);
    for (let fx = 478; fx <= 628; fx += 10) {
      px(ctx, fx, 332, 6, 18, pal.fenceShade);
      px(ctx, fx, 331, 5, 17, pal.fence);
      px(ctx, fx + 1, 329, 3, 2, pal.fence);
    }

    // Lush bushes framing garden corners & left cottage edge
    drawBush(ctx, 480, 126, 28, 18, pal);
    drawBush(ctx, 610, 232, 26, 20, pal);
    drawBush(ctx, 2, 154, 14, 22, pal);
    drawBush(ctx, 2, 264, 14, 24, pal);
    drawFlower(ctx, 4, 198, '#eb6565');
    drawFlower(ctx, 6, 220, '#ffd257');
    drawFlower(ctx, 5, 240, '#ff92b4');
    // Front bottom lawn wildflowers
    for (const [fx, fy, col] of [[44, 348, '#ffd257'], [118, 349, '#ff92b4'], [264, 348, '#87c5ff'], [372, 349, '#eb6565'], [440, 348, '#ffd257']]) {
      drawFlower(ctx, fx, fy, col);
    }

    // 7. Garden Tree Trunk & Ground Shadow (canopy drawn live for breeze sway!)
    px(ctx, 534, 126, 72, 16, 'rgba(20, 36, 22, 0.22)');
    px(ctx, 560, 86, 18, 46, pal.timberDark);
    px(ctx, 562, 86, 14, 44, pal.timber);
    px(ctx, 564, 90, 4, 36, pal.timberLight);
    px(ctx, 571, 96, 2, 26, pal.timberDark);
    // Flared organic roots & grass tufts at trunk base
    px(ctx, 555, 126, 28, 7, pal.timberDark);
    px(ctx, 557, 127, 24, 5, pal.timber);
    px(ctx, 559, 128, 8, 3, pal.timberLight);
    px(ctx, 554, 130, 4, 3, pal.grassDetail);
    px(ctx, 578, 131, 5, 3, pal.grassDetail);
    px(ctx, 556, 129, 2, 3, pal.grass[3]);
    px(ctx, 581, 129, 2, 3, pal.grass[3]);
  }

  function drawCottageStatic(ctx, pal) {
    const c = LAYOUT.cottage;

    // Exterior ground shadow
    px(ctx, c.left - 3, c.bottom + 2, c.right - c.left + 8, 6, 'rgba(20, 30, 18, 0.28)');

    // 1. Stone Chimney rising above roof (x 158..188, y 4..54)
    px(ctx, 158, 6, 30, 44, pal.stoneDark);
    px(ctx, 160, 8, 26, 40, pal.stoneMid);
    for (let cy = 10; cy < 44; cy += 6) {
      px(ctx, 160, cy + 5, 26, 1, pal.stoneDark);
      const off = ((cy / 6) % 2) * 7;
      for (let cx = 162 + off; cx < 184; cx += 13) {
        px(ctx, cx, cy, 1, 5, pal.stoneDark);
        px(ctx, cx + 2, cy + 1, 6, 2, pal.stoneLight);
      }
    }
    px(ctx, 155, 3, 36, 5, pal.stoneLight);
    px(ctx, 155, 7, 36, 2, pal.stoneDark);

    // 2. Terracotta / Cedar Shingled Roof (x 8..474, y 16..62)
    // Sloped roof silhouette
    for (let row = 0; row < 44; row++) {
      const inset = Math.max(0, Math.round((44 - row) * 0.42));
      const rx = 10 + inset;
      const rw = 464 - inset * 2;
      px(ctx, rx, 18 + row, rw, 1, pal.roofMid);
    }
    // Layered scalloped pixel roof shingles
    for (let ry = 22; ry < 58; ry += 6) {
      const inset = Math.max(0, Math.round((44 - (ry - 18)) * 0.42));
      const startX = 12 + inset;
      const endX = 472 - inset;
      const stagger = ((ry / 6) % 2) * 6;
      for (let rx = startX + stagger; rx < endX - 8; rx += 12) {
        px(ctx, rx, ry, 10, 4, pal.roofTop);
        px(ctx, rx + 1, ry, 8, 1, pal.roofRim);
        px(ctx, rx + 1, ry + 4, 8, 1, pal.roofDark);
        px(ctx, rx + 10, ry + 1, 1, 4, pal.roofDark);
      }
    }
    // Roof ridge beam & eaves trim
    px(ctx, 28, 15, 428, 4, pal.timberDark);
    px(ctx, 30, 16, 424, 2, pal.timberLight);
    px(ctx, 8, 58, 468, 5, pal.timberDark);
    px(ctx, 10, 59, 464, 2, pal.timberLight);
    // Roof overhang shadow on interior wall
    px(ctx, c.left + 2, c.top, c.right - c.left - 4, 4, 'rgba(38, 20, 12, 0.30)');

    // 3. Cottage Interior Back Wall (plaster + timber posts + wainscoting)
    px(ctx, c.left + 2, c.top, c.right - c.left - 4, 68, pal.wallPlaster);
    // Subtle plaster texture & horizontal shadow bands
    px(ctx, c.left + 2, c.top + 4, c.right - c.left - 4, 3, pal.wallPlasterShade);
    for (let wx = c.left + 14; wx < c.right - 14; wx += 48) {
      px(ctx, wx, c.top, 4, 44, pal.timberLight);
      px(ctx, wx + 3, c.top, 1, 44, pal.timberDark);
    }
    // Wainscoting wooden lower wall (y 106..130)
    px(ctx, c.left + 2, 105, c.right - c.left - 4, 3, pal.timberLight);
    px(ctx, c.left + 2, 108, c.right - c.left - 4, 20, pal.wainscot);
    for (let wx = c.left + 8; wx < c.right - 6; wx += 14) {
      px(ctx, wx, 109, 10, 17, pal.wainscotLight);
      px(ctx, wx + 1, 110, 8, 15, pal.wainscot);
      px(ctx, wx + 10, 109, 1, 17, pal.wainscotDark);
    }
    // Baseboard trim
    px(ctx, c.left + 2, 127, c.right - c.left - 4, 3, pal.timberDark);

    // 4. Honey-Oak Hardwood Plank Floor (y 130..338)
    for (let fy = c.floorTop; fy < c.bottom; fy += 8) {
      const rowIdx = Math.floor((fy - c.floorTop) / 8);
      px(ctx, c.left + 2, fy, c.right - c.left - 4, 8, pal.floor[rowIdx % 4]);
      px(ctx, c.left + 2, fy, c.right - c.left - 4, 1, 'rgba(255, 236, 198, 0.14)');
      px(ctx, c.left + 2, fy + 7, c.right - c.left - 4, 1, pal.floorLine);
      const offset = (rowIdx * 23) % 44;
      for (let fx = c.left + 12 + offset; fx < c.right - 8; fx += 44) {
        px(ctx, fx, fy, 1, 7, pal.floorLine);
        px(ctx, fx + 8, fy + 3, 14, 1, 'rgba(130, 80, 38, 0.25)');
      }
    }
    // Floor top wall ambient occlusion shadow
    px(ctx, c.left + 2, c.floorTop, c.right - c.left - 4, 5, pal.floorAO);

    // 5. Hand-Woven Stardew Cottage Rug (x 76..420, y 158..304)
    px(ctx, 78, 160, 342, 144, 'rgba(46, 24, 12, 0.18)');
    // Cream fringe tassels left & right
    for (let ty = 162; ty <= 298; ty += 5) {
      px(ctx, 72, ty, 5, 2, '#f2e4c9');
      px(ctx, 420, ty, 5, 2, '#f2e4c9');
    }
    px(ctx, 76, 158, 344, 144, pal.rugOuter);
    px(ctx, 81, 163, 334, 134, pal.rugMid);
    px(ctx, 86, 168, 324, 124, pal.rugInner);
    // Decorative geometric corner motifs & inner border
    px(ctx, 90, 172, 316, 2, pal.rugPattern);
    px(ctx, 90, 286, 316, 2, pal.rugPattern);
    px(ctx, 90, 172, 2, 116, pal.rugPattern);
    px(ctx, 404, 172, 2, 116, pal.rugPattern);
    for (let rx = 98; rx < 398; rx += 14) {
      px(ctx, rx, 165, 6, 2, pal.rugInner);
      px(ctx, rx, 293, 6, 2, pal.rugInner);
    }
    // Subtle center woven Stardew tapestry medallion & soft linen grain
    for (let ry = 176; ry < 284; ry += 6) {
      for (let rx = 96 + ((ry / 6) % 2) * 6; rx < 400; rx += 12) {
        px(ctx, rx, ry, 2, 1, 'rgba(158, 112, 74, 0.14)');
      }
    }
    // Warm woven central diamond motif around the studio center (248, 232)
    const rcx = 248, rcy = 234;
    for (let d = 0; d < 18; d++) {
      const span = 28 - Math.round(d * 1.5);
      if (span > 0) {
        px(ctx, rcx - span, rcy - d, 2, 1, 'rgba(158, 71, 71, 0.28)');
        px(ctx, rcx + span - 2, rcy - d, 2, 1, 'rgba(158, 71, 71, 0.28)');
        px(ctx, rcx - span, rcy + d, 2, 1, 'rgba(158, 71, 71, 0.28)');
        px(ctx, rcx + span - 2, rcy + d, 2, 1, 'rgba(158, 71, 71, 0.28)');
      }
    }
    px(ctx, rcx - 8, rcy - 4, 16, 8, 'rgba(95, 135, 105, 0.18)');
    px(ctx, rcx - 4, rcy - 2, 8, 4, 'rgba(217, 155, 102, 0.32)');
    // Subtle center woven diamond accents in all 4 corners
    for (const [dx, dy] of [[106, 184], [386, 184], [106, 272], [386, 272]]) {
      px(ctx, dx + 2, dy, 4, 8, pal.rugOuter);
      px(ctx, dx, dy + 2, 8, 4, pal.rugOuter);
      px(ctx, dx + 3, dy + 3, 2, 2, pal.rugMid);
    }

    // 6. Two Wide Cottage Windows (Left: x 44..134, Right: x 336..412, y 70..112)
    drawWindowFrame(ctx, 44, 70, 90, 42, pal);
    drawWindowFrame(ctx, 336, 70, 76, 42, pal);

    // 7. Stone Hearth Fireplace (x 150..202, y 72..131)
    px(ctx, 150, 74, 52, 57, pal.stoneDark);
    px(ctx, 152, 76, 48, 54, pal.stoneMid);
    for (let by = 78; by < 126; by += 7) {
      px(ctx, 152, by + 6, 48, 1, pal.stoneDark);
      const off = ((by / 7) % 2) * 8;
      for (let bx = 154 + off; bx < 196; bx += 14) {
        px(ctx, bx, by, 1, 6, pal.stoneDark);
        px(ctx, bx + 2, by + 1, 7, 2, pal.stoneLight);
      }
    }
    // Mantelpiece shelf
    px(ctx, 146, 72, 60, 5, pal.timber);
    px(ctx, 146, 72, 60, 2, pal.timberLight);
    px(ctx, 148, 77, 56, 2, pal.timberDark);
    // Cute mantelpiece trinkets: mini whale figurine + tiny plant + brass candle
    px(ctx, 154, 65, 10, 7, '#5a94d6');
    px(ctx, 156, 66, 6, 3, '#94c5f7');
    px(ctx, 164, 67, 3, 3, '#5a94d6');
    px(ctx, 174, 64, 4, 8, '#f5ebd1');
    px(ctx, 173, 70, 6, 2, '#d4a34a');
    px(ctx, 188, 66, 8, 6, '#b5614e');
    px(ctx, 187, 62, 10, 4, '#59a653');
    px(ctx, 189, 60, 6, 2, '#82c96e');
    // Dark hearth firebox & stacked logs
    px(ctx, 160, 99, 32, 31, '#261a1d');
    px(ctx, 162, 96, 28, 4, '#261a1d');
    px(ctx, 158, 128, 36, 4, pal.stoneLight);
    px(ctx, 164, 122, 24, 5, '#6e4228');
    px(ctx, 167, 120, 18, 4, '#8a5534');
    // Round braided cat mat in front of hearth
    px(ctx, 156, 134, 40, 18, '#b87654');
    px(ctx, 159, 136, 34, 14, '#deb37c');
    px(ctx, 163, 138, 26, 10, '#f2d9b3');

    // 8. Wooden Cork Task Board (x 216..294, y 72..112)
    px(ctx, 217, 74, 78, 39, 'rgba(42, 24, 14, 0.25)');
    px(ctx, 216, 72, 78, 38, pal.timber);
    px(ctx, 217, 73, 76, 36, pal.timberLight);
    px(ctx, 220, 76, 70, 30, '#d6aa76');
    px(ctx, 221, 77, 68, 28, '#c99b66');
    // Subtle cork grain speckles
    for (let cx = 224; cx < 286; cx += 7) {
      px(ctx, cx, 80 + (cx % 17), 1, 1, '#a67a49');
    }

    // 9. Wall Pendulum Clock (x 304..326, y 74..106)
    px(ctx, 305, 76, 22, 30, 'rgba(42, 24, 14, 0.22)');
    px(ctx, 304, 74, 22, 28, pal.timberDark);
    px(ctx, 306, 76, 18, 24, pal.timberLight);
    px(ctx, 308, 78, 14, 12, '#faf2df');
    px(ctx, 310, 92, 10, 7, '#472c1e');

    // 10. Tall Cottage Bookshelf & Gramophone (x 420..460, y 64..131)
    px(ctx, 420, 66, 40, 65, pal.timberDark);
    px(ctx, 422, 68, 36, 61, pal.timber);
    // Retro Brass Gramophone on top shelf (x 425..445, y 66..86)
    px(ctx, 424, 82, 32, 4, pal.wainscotLight);
    px(ctx, 427, 77, 14, 6, '#7a452d');
    px(ctx, 429, 75, 10, 2, '#d4a34a');
    px(ctx, 434, 69, 3, 6, '#d4a34a');
    px(ctx, 436, 65, 8, 7, '#f2c866');
    px(ctx, 442, 66, 3, 5, '#b88535');
    // Tiny potted trailing ivy beside gramophone
    px(ctx, 447, 76, 8, 6, '#b5614e');
    px(ctx, 446, 72, 10, 5, '#5ca856');
    px(ctx, 453, 77, 3, 12, '#4c9449');
    px(ctx, 455, 84, 2, 10, '#6bbf5e');
    // Two rows of colorful leather books
    const bookColors = ['#cf6565', '#e8a85a', '#689cd2', '#64a875', '#a67cd4', '#d97fa5', '#58b3a8'];
    for (let row = 0; row < 2; row++) {
      const sy = 90 + row * 19;
      px(ctx, 424, sy, 32, 14, '#3d2419');
      for (let i = 0; i < 6; i++) {
        const bh = 8 + ((i * 2 + row) % 4);
        const col = bookColors[(i + row * 3) % bookColors.length];
        px(ctx, 426 + i * 5, sy + 14 - bh, 4, bh, col);
        px(ctx, 426 + i * 5, sy + 14 - bh + 2, 4, 1, 'rgba(255,255,255,0.35)');
      }
      px(ctx, 422, sy + 14, 36, 3, pal.wainscotLight);
    }

    // 11. Left Tea & Cookie Sideboard (x 20..52, y 148..206)
    px(ctx, 22, 152, 32, 56, 'rgba(42, 24, 14, 0.22)');
    px(ctx, 20, 150, 31, 54, pal.timberDark);
    px(ctx, 21, 151, 29, 50, pal.wainscot);
    px(ctx, 21, 151, 29, 4, pal.wainscotLight);
    px(ctx, 23, 160, 25, 36, pal.timber);
    px(ctx, 25, 162, 21, 15, pal.wainscot);
    px(ctx, 25, 180, 21, 15, pal.wainscot);
    px(ctx, 41, 168, 2, 3, '#e8c474');
    px(ctx, 41, 186, 2, 3, '#e8c474');
    // Copper Tea Kettle + Cookie Plate + Teacups on counter
    px(ctx, 24, 144, 11, 8, '#c7724c');
    px(ctx, 26, 146, 5, 4, '#eba075');
    px(ctx, 35, 146, 3, 3, '#a65738');
    px(ctx, 27, 142, 5, 2, '#e8c474');
    // Plate of chocolate-chip cookies
    px(ctx, 37, 150, 12, 5, '#faf3e3');
    px(ctx, 39, 148, 4, 4, '#d99852');
    px(ctx, 43, 149, 4, 3, '#c78340');
    px(ctx, 40, 149, 1, 1, '#4f2c1b');
    px(ctx, 44, 150, 1, 1, '#4f2c1b');
    // Stacked pastel teacups
    px(ctx, 24, 154, 6, 5, '#faf3e3');
    px(ctx, 26, 155, 3, 2, '#91c9b5');
    px(ctx, 32, 155, 5, 4, '#f7cad0');

    // 12. Cozy Cottage Armchair + Blue Whale Plushie (x 22..56, y 268..308)
    px(ctx, 24, 298, 34, 10, 'rgba(42, 24, 14, 0.25)');
    px(ctx, 22, 272, 34, 30, '#8f474e');
    px(ctx, 24, 274, 30, 24, '#ba656b');
    px(ctx, 28, 280, 24, 16, '#d98486');
    px(ctx, 22, 270, 34, 6, '#a8575e');
    px(ctx, 21, 284, 7, 18, '#a8575e');
    px(ctx, 50, 284, 7, 18, '#a8575e');
    // Tiny adorable Blue Whale Plushie sitting on the chair!
    px(ctx, 32, 278, 14, 9, '#4c86cf');
    px(ctx, 34, 277, 10, 3, '#72adf2');
    px(ctx, 34, 284, 10, 3, '#e8f4ff');
    px(ctx, 46, 280, 3, 4, '#4c86cf');
    px(ctx, 35, 281, 1, 1, '#1f2336');
    px(ctx, 41, 281, 1, 1, '#1f2336');

    // 13. Lush Potted Indoor Plants
    drawPottedPlant(ctx, 24, 114);
    drawPottedPlant(ctx, 442, 306);
    drawPottedPlant(ctx, 24, 314);

    // 14. Cottage Exterior Timber Frame & Cutaway Walls (with Open Right Doorway!)
    // Left wall cutaway
    px(ctx, c.left - 4, c.top - 2, 7, c.bottom - c.top + 8, pal.timberDark);
    px(ctx, c.left - 2, c.top, 4, c.bottom - c.top + 4, pal.timber);
    // Right wall cutaway ABOVE doorway (y 60..168)
    px(ctx, c.right - 3, c.top - 2, 7, LAYOUT.doorway.top - c.top + 2, pal.timberDark);
    px(ctx, c.right - 1, c.top, 4, LAYOUT.doorway.top - c.top, pal.timber);
    // Right wall cutaway BELOW doorway (y 234..344)
    px(ctx, c.right - 3, LAYOUT.doorway.bottom, 7, c.bottom - LAYOUT.doorway.bottom + 6, pal.timberDark);
    px(ctx, c.right - 1, LAYOUT.doorway.bottom, 4, c.bottom - LAYOUT.doorway.bottom + 4, pal.timber);
    // Open Arched Wooden Doorway Frame & Swung Open Door!
    px(ctx, c.right - 3, LAYOUT.doorway.top - 3, 8, 5, pal.timberLight);
    px(ctx, c.right - 3, LAYOUT.doorway.bottom - 2, 8, 5, pal.timberLight);
    // Door threshold sill
    px(ctx, c.right - 2, LAYOUT.doorway.top + 2, 6, LAYOUT.doorway.bottom - LAYOUT.doorway.top - 4, pal.wainscotLight);
    px(ctx, c.right - 1, LAYOUT.doorway.top + 2, 2, LAYOUT.doorway.bottom - LAYOUT.doorway.top - 4, pal.wainscot);
    // Swung-open wooden door leaf on upper jamb
    px(ctx, c.right + 3, LAYOUT.doorway.top - 2, 16, 4, pal.timberDark);
    px(ctx, c.right + 4, LAYOUT.doorway.top - 1, 14, 2, pal.wainscotLight);
    // Front cutaway bottom wall beam
    px(ctx, c.left - 4, c.bottom, c.right - c.left + 8, 7, pal.timberDark);
    px(ctx, c.left - 2, c.bottom + 1, c.right - c.left + 4, 4, pal.timber);
    px(ctx, c.left - 2, c.bottom + 1, c.right - c.left + 4, 1, pal.timberLight);
  }

  function drawWindowFrame(ctx, x, y, w, h, pal) {
    // Drop shadow
    px(ctx, x + 2, y + 3, w, h, 'rgba(42, 24, 14, 0.18)');
    // Outer oak casing
    px(ctx, x, y, w, h, pal.timberDark);
    px(ctx, x + 1, y + 1, w - 2, h - 2, pal.timberLight);
    // Glass pane base (sky/clouds/stars animated inside on live layer!)
    px(ctx, x + 4, y + 4, w - 8, h - 9, pal.windowGlass);
    // Distant hills inside window
    px(ctx, x + 4, y + h - 13, w - 8, 8, pal.hillNear);
    // Wooden cross mullions
    const midX = x + Math.floor(w / 2);
    px(ctx, midX - 1, y + 3, 3, h - 7, pal.timberLight);
    px(ctx, x + 3, y + Math.floor(h * 0.56), w - 6, 2, pal.timberLight);
    // Ruffled cozy cottage curtains on left & right edges
    px(ctx, x + 4, y + 4, 10, h - 9, pal.curtain);
    px(ctx, x + 12, y + 4, 2, h - 9, pal.curtainShade);
    px(ctx, x + 4, y + 20, 8, 2, '#f5e1a4'); // tie ribbon
    px(ctx, x + w - 14, y + 4, 10, h - 9, pal.curtain);
    px(ctx, x + w - 14, y + 4, 2, h - 9, pal.curtainShade);
    px(ctx, x + w - 12, y + 20, 8, 2, '#f5e1a4');
    // Window sill + cute flower box!
    px(ctx, x - 3, y + h - 4, w + 6, 5, pal.timberLight);
    px(ctx, x - 3, y + h, w + 6, 2, pal.timberDark);
    // Tiny sill blooms
    px(ctx, x + 18, y + h - 7, 14, 3, '#4c9449');
    px(ctx, x + 20, y + h - 9, 3, 2, '#ff8aa3');
    px(ctx, x + 27, y + h - 8, 3, 2, '#ffe066');
    px(ctx, x + w - 32, y + h - 7, 14, 3, '#4c9449');
    px(ctx, x + w - 29, y + h - 9, 3, 2, '#ffd257');
    px(ctx, x + w - 22, y + h - 8, 3, 2, '#a7d7ff');
  }

  function drawPottedPlant(ctx, x, y) {
    px(ctx, x + 2, y + 18, 14, 4, 'rgba(35, 20, 12, 0.25)');
    px(ctx, x + 4, y + 12, 10, 9, '#b55d4a');
    px(ctx, x + 5, y + 13, 3, 7, '#d47c66');
    px(ctx, x + 3, y + 10, 12, 3, '#d47c66');
    px(ctx, x + 4, y + 12, 10, 1, '#7d3a2d');
    // Lush layered pixel monstera leaves
    px(ctx, x + 8, y + 3, 2, 8, '#3b7a40');
    px(ctx, x + 2, y + 4, 6, 5, '#4c994c');
    px(ctx, x + 3, y + 5, 4, 2, '#78c468');
    px(ctx, x + 10, y + 2, 6, 5, '#5ca856');
    px(ctx, x + 11, y + 3, 4, 2, '#91db7b');
    px(ctx, x + 5, y, 7, 5, '#6bbf5e');
    px(ctx, x + 7, y + 1, 3, 2, '#a8eb8d');
    px(ctx, x + 1, y + 8, 6, 3, '#3b7a40');
    px(ctx, x + 11, y + 7, 6, 3, '#4c994c');
  }

  function buildBackground(canvas, pal) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSkyAndHorizon(ctx, pal, canvas.width);
    drawMeadow(ctx, pal, canvas.width, canvas.height);
    drawGardenStatic(ctx, pal);
    drawCottageStatic(ctx, pal);
  }

  // ── Live Animated Environment Layers ──

  function drawSkyDynamic(ctx, pal, now, still) {
    const t = still ? 0 : now * 0.001;
    if (pal.id === 'night') {
      // Twinkling stars + warm crescent moon
      const stars = [
        [24, 12], [68, 8], [116, 14], [218, 9], [286, 11], [352, 8],
        [434, 12], [492, 10], [526, 22], [562, 12], [608, 16], [626, 28],
      ];
      for (let i = 0; i < stars.length; i++) {
        const [sx, sy] = stars[i];
        const bright = Math.sin(t * 2.4 + i * 1.7) > 0.15;
        px(ctx, sx, sy, 1, 1, bright ? '#fff6cf' : '#8da3d6');
        if (bright && i % 3 === 0) {
          px(ctx, sx - 1, sy, 3, 1, 'rgba(255, 246, 207, 0.55)');
          px(ctx, sx, sy - 1, 1, 3, 'rgba(255, 246, 207, 0.55)');
        }
      }
      // Crescent moon in right sky
      px(ctx, 502, 10, 10, 10, '#ffebb0');
      px(ctx, 504, 8, 6, 14, '#ffebb0');
      px(ctx, 507, 9, 7, 9, pal.sky[0]);
      // Window night stars
      for (const [wx, wy] of [[68, 80], [98, 78], [110, 86], [356, 80], [386, 84]]) {
        const on = Math.sin(t * 2.1 + wx) > 0;
        px(ctx, wx, wy, 1, 1, on ? '#fff6cf' : '#7b92c7');
      }
    } else {
      // Drifting fluffy Stardew clouds clipped cleanly behind the cottage roof!
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 640, 15);
      ctx.rect(474, 15, 166, 36);
      ctx.clip();
      const clouds = [
        { base: 40, y: 6, w: 34, speed: 3.5 },
        { base: 240, y: 4, w: 42, speed: 2.6 },
        { base: 492, y: 12, w: 38, speed: 3.1 },
        { base: 575, y: 24, w: 28, speed: 2.2 },
      ];
      for (const cl of clouds) {
        const cx = Math.round(((cl.base + t * cl.speed) % 690) - 45);
        px(ctx, cx + 4, cl.y, cl.w - 8, 5, pal.cloudMain);
        px(ctx, cx, cl.y + 3, cl.w, 5, pal.cloudMain);
        px(ctx, cx + 2, cl.y + 7, cl.w - 4, 2, pal.cloudShade);
      }
      ctx.restore();
      // Tiny passing cloud inside windows
      const wCloud = Math.round((t * 4) % 52);
      px(ctx, 58 + (wCloud % 42), 79, 14, 4, pal.cloudMain);
      px(ctx, 352 + ((wCloud + 18) % 34), 81, 12, 3, pal.cloudMain);
    }

    // Chimney gentle pixel smoke puffs (when hearth is lit!)
    if (!still) {
      for (let i = 0; i < 4; i++) {
        const phase = (t * 0.45 + i * 0.25) % 1;
        const sx = Math.round(170 + Math.sin(phase * 5 + i) * 4 + phase * 10);
        const sy = Math.round(2 - phase * 18);
        const sz = Math.round(4 + phase * 5);
        if (sy > -12) {
          ctx.fillStyle = `rgba(245, 240, 232, ${(1 - phase) * 0.55})`;
          ctx.fillRect(sx, Math.max(0, sy), sz, Math.max(2, sz - 1));
        }
      }
    }
  }

  function drawSunBeams(ctx, pal) {
    if (!pal.sunBeam) return;
    ctx.save();
    ctx.fillStyle = pal.sunBeam;
    for (const wx of [54, 344]) {
      ctx.beginPath();
      ctx.moveTo(wx, 112);
      ctx.lineTo(wx + 62, 112);
      ctx.lineTo(wx + 94, 198);
      ctx.lineTo(wx + 24, 198);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHearthAndCat(ctx, pal, now, still, interactive) {
    const t = still ? 0 : now * 0.001;
    // Crackling pixel fire inside stone hearth
    if (interactive.hearthLit) {
      const f = still ? 0 : Math.floor(now / 150) % 4;
      const flicker = [0, 1, -1, 1][f];
      // Warm glow pool onto fireplace rug
      const grad = ctx.createRadialGradient(176, 128, 4, 176, 134, 52);
      grad.addColorStop(0, `rgba(255, 168, 76, ${pal.lampGlow * 0.52})`);
      grad.addColorStop(1, 'rgba(255, 168, 76, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(122, 92, 108, 86);

      px(ctx, 166, 113 + flicker, 20, 11, '#e85d38');
      px(ctx, 169, 109 - flicker, 14, 13, '#f5933b');
      px(ctx, 172, 112, 8, 9, '#ffd666');
      px(ctx, 174, 115 + flicker, 4, 5, '#fff6cc');
      if (!still && f % 2 === 0) {
        px(ctx, 171 + f * 2, 104, 1, 1, '#ffd666');
        px(ctx, 181 - f, 102, 1, 1, '#ff9c47');
      }
    }

    // Sleepy Calico / Orange Cat curled on hearth mat (x 176, y 143)
    const happy = interactive.catHappyUntil > now;
    const hop = happy && !still ? Math.round(Math.abs(Math.sin(t * 14)) * 3) : 0;
    const breath = !still && Math.floor(now / 700) % 2 === 0 ? 0 : 1;
    const cx = 168, cy = 136 - hop;
    // Shadow
    px(ctx, cx + 1, 145, 14, 3, 'rgba(60, 32, 16, 0.24)');
    // Curled body
    px(ctx, cx + 2, cy + 3 + breath, 12, 7 - breath, '#e8964a');
    px(ctx, cx + 4, cy + 4 + breath, 7, 4 - breath, '#f7ba74');
    px(ctx, cx + 10, cy + 5, 4, 4, '#fff6e8');
    // Head + tiny ears
    px(ctx, cx, cy + 2, 7, 6, '#e8964a');
    px(ctx, cx + 1, cy, 2, 2, '#d17b34');
    px(ctx, cx + 5, cy, 2, 2, '#d17b34');
    px(ctx, cx + 1, cy + 5, 5, 2, '#fff6e8');
    // Eyes (happy ^ ^ or sleepy - -)
    px(ctx, cx + 1, cy + 4, 2, 1, happy ? '#592c1c' : '#7a4526');
    px(ctx, cx + 4, cy + 4, 2, 1, happy ? '#592c1c' : '#7a4526');
    // Swishing tail
    const tailShift = !still && Math.floor(now / 420) % 2 === 0 ? 0 : 1;
    px(ctx, cx + 13, cy + 6 - tailShift, 3, 2, '#d17b34');
    px(ctx, cx + 15, cy + 5 - tailShift, 2, 2, '#fff6e8');

    // Floating heart when petted!
    if (happy) {
      drawPixelHeart(ctx, cx + 5, cy - 8 - Math.round((t * 10) % 6), '#ff6b8b');
    }
  }

  function drawTeaAndMusicDynamic(ctx, pal, now, still, interactive) {
    const t = still ? 0 : now * 0.001;
    // Kettle rising steam wisps
    const brewing = interactive.teaBrewUntil > now;
    const puffs = brewing ? 4 : 2;
    if (!still) {
      for (let i = 0; i < puffs; i++) {
        const p = (t * (brewing ? 1.1 : 0.55) + i / puffs) % 1;
        const sx = Math.round(29 + Math.sin(p * 6 + i) * 2);
        const sy = Math.round(140 - p * (brewing ? 18 : 11));
        ctx.fillStyle = `rgba(255, 250, 240, ${(1 - p) * (brewing ? 0.85 : 0.5)})`;
        ctx.fillRect(sx, sy, brewing ? 3 : 2, 2);
      }
    }

    // Wall Clock ticking hands & pendulum (x 315, y 84)
    const sec = still ? 0 : Math.floor(now / 1000);
    px(ctx, 315, 80, 1, 5, '#3b241c');
    px(ctx, 315, 84, 4, 1, '#9e4747');
    const pend = still ? 0 : (sec % 2 === 0 ? -1 : 1);
    px(ctx, 315 + pend, 93, 1, 4, '#d4a34a');
    px(ctx, 314 + pend, 96, 3, 2, '#f2c866');

    // Gramophone floating pixel music notes when active
    if (interactive.musicOn && !still) {
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.42 + i * 0.33) % 1;
        const nx = Math.round(438 + Math.sin(p * 5 + i * 2) * 8);
        const ny = Math.round(64 - p * 26);
        const col = ['#ffe066', '#ff9ebb', '#9ce6ff'][i];
        ctx.globalAlpha = Math.sin(p * Math.PI);
        px(ctx, nx, ny + 3, 3, 2, col);
        px(ctx, nx + 2, ny, 1, 4, col);
        px(ctx, nx + 2, ny, 3, 1, col);
        ctx.globalAlpha = 1;
      }
    }

    // Plushie bounce when squeezed
    if (interactive.plushieBounceUntil > now) {
      drawPixelHeart(ctx, 36, 266 - Math.round((t * 12) % 6), '#6bc5ff');
    }
  }

  function drawPondDynamic(ctx, pal, now, still, interactive) {
    const t = still ? 0 : now * 0.001;
    // Water shimmer lines
    for (let i = 0; i < 5; i++) {
      const sx = 542 + ((i * 15 + Math.floor(t * 4)) % 68);
      const sy = 172 + i * 8;
      px(ctx, sx, sy, 5, 1, pal.pondSparkle);
    }
    // Lily pads & pink lotus
    const bob = still ? 0 : Math.round(Math.sin(t * 2.2) * 1);
    px(ctx, 542, 174 + bob, 11, 7, '#4c994c');
    px(ctx, 544, 175 + bob, 7, 4, '#6bbf5e');
    px(ctx, 550, 176 + bob, 3, 2, pal.pondWater); // notch
    px(ctx, 594, 194 - bob, 12, 8, '#4c994c');
    px(ctx, 596, 195 - bob, 8, 5, '#6bbf5e');
    // Pink lotus flower on lily pad
    px(ctx, 598, 192 - bob, 5, 4, '#ff9ebb');
    px(ctx, 600, 191 - bob, 2, 2, '#ffe899');

    // Swimming Orange & White Pixel Koi Fish!
    const angle = t * 0.9;
    const kx = Math.round(576 + Math.cos(angle) * 22);
    const ky = Math.round(188 + Math.sin(angle * 2) * 11);
    const dir = -Math.sin(angle) >= 0 ? 1 : -1;
    px(ctx, kx - 3, ky - 1, 7, 3, '#ff7b3b');
    px(ctx, kx - 1, ky - 1, 3, 2, '#fff5e6');
    px(ctx, kx - dir * 5, ky - 1 + (Math.floor(t * 8) % 2), 2, 3, '#ff9d5c');

    // Interactive pond ripple rings when user clicks pond!
    if (interactive.pondRippleUntil > now && !still) {
      const p = 1 - (interactive.pondRippleUntil - now) / 1400;
      const rad = Math.round(3 + p * 18);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - p) * 0.75})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(576 - rad, 188 - Math.round(rad * 0.6), rad * 2, Math.round(rad * 1.2));
    }
  }

  function drawTreeCanopy(ctx, pal, now, still, weather, interactive) {
    const t = still ? 0 : now * 0.001;
    const shaking = interactive.treeShakeUntil > now && !still;
    const sway = shaking ? Math.round(Math.sin(t * 38) * 2) : (still ? 0 : Math.round(Math.sin(t * 1.4) * 1));
    const leaves = weather === 'sakura' ? pal.sakuraLeaves : pal.treeLeaves;
    const cx = 569 + sway, cy = 95;

    // Hand-crafted lush Stardew Valley pixel tree canopy sitting snugly over trunk (y=86..130)
    const canopyRows = [
      '..........222222..........',
      '........2233333222........',
      '......2233333333222.......',
      '.....233333322333221......',
      '....23332222222222111.....',
      '...2233222333222211111....',
      '..22222223333222111110....',
      '.2233222222222211111100...',
      '.2333222222221111221100...',
      '222222112222111122211000..',
      '222211111121111111110000..',
      '122111111111111111100000..',
      '.1111101111111011100000...',
      '.1110000111100001000000...',
      '..00000001000000000000....',
      '...00000..000000..000.....',
    ];
    const map = { '0': leaves[0], '1': leaves[1], '2': leaves[2], '3': leaves[3] };
    drawBitmap(ctx, cx - 39, cy - 48, canopyRows, map, 3);

    // Extra delicate outer pixel leaves & hanging blossom clusters
    const dotCol = weather === 'sakura' ? '#fff2f7' : '#ffe37d';
    const subCol = weather === 'sakura' ? '#ffd6e6' : leaves[3];
    for (const [dx, dy] of [[-24, -26], [-6, -38], [14, -28], [22, -10], [-14, -4], [4, -14], [-28, -8]]) {
      px(ctx, cx + dx, cy + dy, 2, 2, dotCol);
      px(ctx, cx + dx + 2, cy + dy + 1, 1, 1, subCol);
    }
    // Delicate hanging leaf/blossom tufts under lower boughs
    px(ctx, cx - 24, cy - 2, 4, 5, leaves[0]);
    px(ctx, cx + 20, cy - 3, 4, 6, leaves[0]);
    if (weather === 'sakura') {
      px(ctx, cx - 23, cy + 2, 3, 2, '#ffb8d0');
      px(ctx, cx + 21, cy + 2, 3, 2, '#ffd6e6');
    }
  }

  function drawBoardNotes(ctx, seats, lamps) {
    // Live status sticky notes pinned on the wooden corkboard (x 222..288, y 78..104)
    const noteXStart = seats.length === 3 ? 228 : 223;
    const step = seats.length === 3 ? 20 : 16;
    for (const [index, seat] of seats.entries()) {
      const nx = noteXStart + index * step;
      const ny = 81 + (index % 2) * 3;
      px(ctx, nx + 1, ny + 1, 13, 14, 'rgba(60, 35, 16, 0.25)');
      px(ctx, nx, ny, 13, 14, '#fff7dc');
      px(ctx, nx + 5, ny - 1, 3, 2, '#d95757'); // pushpin
      px(ctx, nx + 2, ny + 3, 9, 2, seat.accent);
      px(ctx, nx + 2, ny + 7, 9, 4, lamps[seat.status] || '#667791');
    }
  }

  // ── Desks, Chairs & Character-Unique Desk Trinkets (Zero Occlusion!) ──

  function drawTrinket(ctx, spriteKey, x, y, now, still) {
    if (spriteKey === 'gemini') {
      // Glowing 4-point star crystal lamp!
      const glow = !still && Math.floor(now / 500) % 2 === 0 ? '#ffe885' : '#d5b5ff';
      px(ctx, x + 2, y + 6, 4, 2, '#5c4680');
      px(ctx, x + 3, y + 1, 2, 6, glow);
      px(ctx, x + 1, y + 3, 6, 2, glow);
    } else if (spriteKey === 'qwen') {
      // Blue porcelain teacup & tiny scroll
      px(ctx, x + 1, y + 4, 5, 4, '#eef4ff');
      px(ctx, x + 2, y + 5, 3, 2, '#5e8de6');
      px(ctx, x + 6, y + 5, 2, 2, '#eef4ff');
    } else if (spriteKey === 'dayu' || spriteKey === 'whale') {
      // Mini whale mug & paintbrush
      px(ctx, x + 1, y + 3, 6, 5, '#4c86cf');
      px(ctx, x + 2, y + 5, 4, 2, '#dff2ff');
      px(ctx, x + 7, y + 1, 1, 7, '#d4a34a');
      px(ctx, x + 7, y, 2, 2, '#5cb6ff');
    } else if (spriteKey === 'hy') {
      // Red-scarf cocoa mug
      px(ctx, x + 1, y + 3, 6, 5, '#faf3e3');
      px(ctx, x + 1, y + 5, 6, 2, '#d94c4c');
      px(ctx, x + 7, y + 4, 2, 3, '#faf3e3');
    } else if (spriteKey === 'orange') {
      // Mini sunflower pot
      px(ctx, x + 2, y + 5, 5, 3, '#b55d4a');
      px(ctx, x + 4, y + 2, 1, 3, '#4c9449');
      px(ctx, x + 2, y, 5, 3, '#ffb838');
      px(ctx, x + 4, y + 1, 1, 1, '#5e341c');
    } else {
      // Cozy cream tea mug
      px(ctx, x + 1, y + 3, 6, 5, '#f2e4cf');
      px(ctx, x + 2, y + 4, 4, 2, '#b87d52');
      px(ctx, x + 7, y + 4, 2, 3, '#f2e4cf');
    }
  }

  function drawLeadStation(ctx, pal, lead, pose, now, still, pendingCount, gesture, eventStyles, drawCharacterFn) {
    const { x, y } = LAYOUT.station;

    // 1. Subtle floor shadow under grand oak desk
    px(ctx, x - 64, y + 12, 128, 8, pal.floorAO);

    // 2. Low-back cozy velvet executive chair (stays behind shoulders, NEVER blocks face!)
    px(ctx, x - 14, y - 24, 28, 22, '#4a2e3b');
    px(ctx, x - 12, y - 22, 24, 18, '#7a495c');
    px(ctx, x - 10, y - 20, 20, 4, '#9e6377');

    // 3. Draw Lead Character cleanly IN FRONT of chair back and BEHIND desk top!
    if (pose.seated) drawCharacterFn(ctx, lead.sprite, pose);

    // 4. Grand Carved Honey-Oak Executive Desk (y - 6 to y + 15)
    px(ctx, x - 62, y - 6, 124, 12, pal.wainscot);
    px(ctx, x - 64, y - 7, 128, 3, pal.wainscotLight);
    px(ctx, x - 64, y + 5, 128, 3, pal.timberDark);
    // Front wooden modesty panel & drawers
    px(ctx, x - 59, y + 8, 118, 11, pal.timber);
    px(ctx, x - 54, y + 9, 108, 8, pal.wainscotDark);
    px(ctx, x - 50, y + 10, 100, 2, pal.wainscot);
    // Brass drawer pulls
    px(ctx, x - 44, y + 13, 6, 2, '#e8c474');
    px(ctx, x + 38, y + 13, 6, 2, '#e8c474');
    // Sturdy desk feet
    px(ctx, x - 60, y + 17, 7, 4, pal.timberDark);
    px(ctx, x + 53, y + 17, 7, 4, pal.timberDark);

    // 5. Side-mounted Retro Monitor on LEFT of desk (never blocks Lead's face!)
    const screenCol = gesture ? eventStyles[gesture.kind].color :
      lead.status === 'running' ? '#7ce8b8' : lead.status === 'review' ? '#c2b0ff' : '#5b8a99';
    px(ctx, x - 54, y - 21, 26, 15, '#3b3347');
    px(ctx, x - 52, y - 19, 22, 11, '#262133');
    px(ctx, x - 51, y - 18, 20, 9, screenCol);
    // Animated tiny code/review lines on Lead screen
    const scroll = still ? 0 : Math.floor(now / 260) % 4;
    px(ctx, x - 49, y - 16, 8 + scroll * 2, 1, '#fff9eb');
    px(ctx, x - 49, y - 14, 13 - scroll, 1, '#314552');
    px(ctx, x - 49, y - 12, 10, 1, '#314552');
    px(ctx, x - 43, y - 6, 4, 3, '#3b3347');
    px(ctx, x - 47, y - 4, 12, 2, '#4f455e');

    // Open parchment notebook & keyboard in center-front (low profile!)
    px(ctx, x - 14, y - 4, 24, 5, '#faf0d7');
    px(ctx, x - 12, y - 3, 9, 1, '#b8a082');
    px(ctx, x - 12, y - 1, 7, 1, '#b8a082');
    px(ctx, x + 1, y - 3, 7, 1, '#b8a082');

    // 6. Neat Stacks of Task Scrolls & Folders on RIGHT
    const stacks = [
      { dx: 18, height: 2 + Math.min(3, pendingCount), colors: ['#f2c572', '#e08979', '#b6a3eb'] },
      { dx: 33, height: 3, colors: ['#86c4a8', '#e3b278', '#d991a3'] },
    ];
    for (const st of stacks) {
      for (let i = 0; i < st.height; i++) {
        const lx = x + st.dx + (i % 2);
        const ly = y - 4 - i * 3;
        px(ctx, lx, ly, 12, 3, st.colors[i % st.colors.length]);
        px(ctx, lx + 1, ly + 2, 10, 1, 'rgba(54, 36, 28, 0.35)');
      }
    }

    // 7. Warm Brass Banker's Lamp on far right (x + 49) with soft glow halo!
    const lampOn = pal.lampGlow > 0.3 || lead.status === 'running' || lead.status === 'review';
    if (lampOn) {
      const g = ctx.createRadialGradient(x + 51, y - 10, 2, x + 51, y - 8, 28);
      g.addColorStop(0, `rgba(255, 222, 138, ${Math.max(0.32, pal.lampGlow * 0.65)})`);
      g.addColorStop(1, 'rgba(255, 222, 138, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 23, y - 36, 56, 56);
    }
    px(ctx, x + 48, y - 4, 7, 2, '#b88535');
    px(ctx, x + 51, y - 12, 2, 8, '#d4a34a');
    px(ctx, x + 46, y - 17, 11, 5, '#488c5c');
    px(ctx, x + 47, y - 16, 9, 2, '#6bbf7b');
    px(ctx, x + 48, y - 12, 7, 2, lampOn ? '#fff2b0' : '#a39985');
  }

  function drawWorkerDesk(ctx, pal, seat, pose, now, still, lamps, drawCharacterFn) {
    const { x, deskY, sprite, status } = seat;
    const lamp = lamps[status] || '#667791';
    const isWorking = status === 'running';
    const isQueued = status === 'queued';
    const isReview = status === 'review';
    const isAsleep = status === 'unavailable';

    // 1. Floor ambient shadow
    px(ctx, x - 38, deskY + 11, 76, 7, pal.floorAO);

    // 2. Cozy Wooden Chair Back behind girl (low height so head/ears/hair shine!)
    px(ctx, x - 19, deskY - 22, 20, 22, pal.timberDark);
    px(ctx, x - 17, deskY - 20, 16, 16, pal.wainscot);
    px(ctx, x - 15, deskY - 18, 12, 4, seat.accent);

    // 3. Draw Seated AI Girl cleanly IN FRONT of chair, BEHIND desk!
    if (pose.seated) drawCharacterFn(ctx, sprite, pose);

    // 4. Honey-Oak Wooden Desk (width 72: x - 36 to x + 36)
    px(ctx, x - 36, deskY - 6, 72, 10, pal.wainscot);
    px(ctx, x - 37, deskY - 7, 74, 3, pal.wainscotLight);
    px(ctx, x - 37, deskY + 3, 74, 3, pal.timberDark);
    // Desk legs & side drawer cabinet
    px(ctx, x - 33, deskY + 6, 5, 11, pal.timberDark);
    px(ctx, x - 32, deskY + 6, 3, 10, pal.timber);
    px(ctx, x + 22, deskY + 6, 12, 11, pal.timberDark);
    px(ctx, x + 23, deskY + 6, 10, 9, pal.timber);
    px(ctx, x + 26, deskY + 9, 4, 1, '#e8c474');
    px(ctx, x + 26, deskY + 13, 4, 1, '#e8c474');

    // 5. Right-Side Monitor (x + 11 to x + 33) — NEVER blocks the AI girl!
    px(ctx, x + 11, deskY - 24, 22, 15, '#3b3347');
    px(ctx, x + 13, deskY - 22, 18, 11, '#262133');
    px(ctx, x + 14, deskY - 21, 16, 9, isAsleep ? '#3c4359' : lamp);
    // Animated screen contents per work state!
    if (isWorking) {
      const f = still ? 0 : Math.floor(now / 150) % 4;
      px(ctx, x + 16, deskY - 19, 6 + (f % 3) * 3, 1, '#1d3b32');
      px(ctx, x + 16, deskY - 17, 11 - (f % 2) * 3, 1, '#ffffff');
      px(ctx, x + 16, deskY - 15, 5 + ((f + 1) % 3) * 2, 1, '#1d3b32');
      // Subtle screen glow halo on desk!
      ctx.fillStyle = 'rgba(126, 229, 187, 0.22)';
      ctx.fillRect(x + 8, deskY - 27, 28, 22);
    } else if (isQueued) {
      const dot = still ? 1 : Math.floor(now / 320) % 3;
      for (let d = 0; d < 3; d++) {
        px(ctx, x + 17 + d * 4, deskY - 17 - (d === dot ? 1 : 0), 2, 2, '#5c3c16');
      }
    } else if (isReview) {
      px(ctx, x + 16, deskY - 19, 10, 1, '#3b2c63');
      px(ctx, x + 16, deskY - 17, 7, 1, '#3b2c63');
      px(ctx, x + 24, deskY - 16, 4, 3, '#fff9eb');
    } else if (isAsleep) {
      px(ctx, x + 18, deskY - 17, 8, 1, '#636d8a');
    } else {
      px(ctx, x + 16, deskY - 18, 8, 1, '#d8e3f2');
      px(ctx, x + 16, deskY - 16, 5, 1, '#a9bad4');
    }
    // Monitor stand
    px(ctx, x + 20, deskY - 9, 4, 3, '#3b3347');
    px(ctx, x + 17, deskY - 7, 10, 2, '#4f455e');

    // Keyboard & mouse pad in front of character
    px(ctx, x - 20, deskY - 4, 18, 3, '#4c445c');
    px(ctx, x - 18, deskY - 3, 14, 1, '#7a708c');
    px(ctx, x + 2, deskY - 4, 5, 3, seat.accent);

    // Character-unique cute desk trinket on far left!
    drawTrinket(ctx, sprite, x - 33, deskY - 13, now, still);

    // Status LED indicator gem on desk front corner
    px(ctx, x + 28, deskY - 2, 4, 3, lamp);
  }

  // ── Cute Pixel Emotes, Work-State FX, Speech Bubbles & Weather Particles ──

  function drawPixelHeart(ctx, x, y, color = '#ff6b8b') {
    const rows = [
      '.##.##.',
      '#######',
      '#######',
      '.#####.',
      '..###..',
      '...#...',
    ];
    drawBitmap(ctx, Math.round(x), Math.round(y), rows, { '#': color });
  }

  function drawPixelStar(ctx, x, y, color = '#ffe066') {
    const rows = [
      '..#..',
      '.###.',
      '#####',
      '.###.',
      '..#..',
    ];
    drawBitmap(ctx, Math.round(x), Math.round(y), rows, { '#': color });
  }

  function drawEmoteBubble(ctx, x, y, kind, now, still) {
    const bob = still ? 0 : Math.round(Math.sin(now * 0.006) * 1.5);
    const bx = Math.round(x - 8);
    const by = Math.round(y - 16 + bob);
    // Warm cream Stardew speech bubble with pixel tail
    px(ctx, bx + 1, by, 15, 13, '#4a352a');
    px(ctx, bx, by + 1, 17, 11, '#4a352a');
    px(ctx, bx + 1, by + 1, 15, 11, '#fff9eb');
    px(ctx, bx + 6, by + 12, 4, 2, '#fff9eb');
    px(ctx, bx + 7, by + 14, 2, 1, '#4a352a');

    if (kind === 'heart') {
      drawPixelHeart(ctx, bx + 5, by + 3, '#f25f7c');
    } else if (kind === 'music') {
      px(ctx, bx + 5, by + 7, 3, 2, '#6d5ce6');
      px(ctx, bx + 7, by + 3, 1, 5, '#6d5ce6');
      px(ctx, bx + 7, by + 3, 5, 1, '#6d5ce6');
      px(ctx, bx + 11, by + 3, 1, 4, '#6d5ce6');
      px(ctx, bx + 9, by + 6, 3, 2, '#6d5ce6');
    } else if (kind === 'tea') {
      px(ctx, bx + 5, by + 5, 6, 5, '#8fc4a0');
      px(ctx, bx + 11, by + 6, 2, 3, '#8fc4a0');
      px(ctx, bx + 7, by + 3, 1, 2, '#d9a468');
      px(ctx, bx + 9, by + 2, 1, 2, '#d9a468');
    } else if (kind === 'star') {
      drawPixelStar(ctx, bx + 6, by + 4, '#f2b830');
    } else if (kind === 'chat') {
      const f = still ? 2 : Math.floor(now / 260) % 3;
      for (let i = 0; i < 3; i++) {
        px(ctx, bx + 4 + i * 4, by + 6 - (i === f ? 1 : 0), 2, 2, '#7a5a48');
      }
    } else if (kind === 'alert') {
      px(ctx, bx + 7, by + 2, 3, 5, '#db4655');
      px(ctx, bx + 7, by + 8, 3, 2, '#db4655');
    } else if (kind === 'check') {
      px(ctx, bx + 4, by + 6, 2, 2, '#2d9e64');
      px(ctx, bx + 6, by + 8, 2, 2, '#2d9e64');
      px(ctx, bx + 8, by + 6, 2, 2, '#2d9e64');
      px(ctx, bx + 10, by + 4, 2, 2, '#2d9e64');
    } else if (kind === 'fish') {
      px(ctx, bx + 5, by + 5, 6, 3, '#f27c38');
      px(ctx, bx + 11, by + 4, 2, 5, '#f27c38');
      px(ctx, bx + 6, by + 6, 1, 1, '#262133');
    } else if (kind === 'code') {
      px(ctx, bx + 4, by + 5, 2, 3, '#2d9e64');
      px(ctx, bx + 7, by + 4, 3, 5, '#5b82e6');
      px(ctx, bx + 11, by + 5, 2, 3, '#2d9e64');
    }
  }

  function drawWorkStateFx(ctx, seat, pose, now, still) {
    const x = Math.round(pose.x);
    const topY = Math.round(pose.foot - (pose.seated ? 36 : 56));
    const t = still ? 0 : now * 0.001;

    if (seat.status === 'running' && pose.seated) {
      // Energetic pixel typing sparks / code sparkles above monitor & head!
      if (!still) {
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.9 + i * 0.33) % 1;
          const sx = Math.round(x + 14 + Math.sin(p * 6 + i) * 7);
          const sy = Math.round(topY + 6 - p * 16);
          ctx.globalAlpha = Math.sin(p * Math.PI);
          px(ctx, sx, sy, 2, 2, ['#7ee5bb', '#ffe066', '#9ce6ff'][i]);
          ctx.globalAlpha = 1;
        }
      }
      drawEmoteBubble(ctx, x + 16, topY + 2, 'code', now, still);
    } else if (seat.status === 'queued' && pose.seated) {
      drawEmoteBubble(ctx, x + 14, topY + 2, 'chat', now, still);
    } else if (seat.status === 'review') {
      drawEmoteBubble(ctx, x + 14, topY + 2, 'star', now, still);
    } else if (seat.status === 'attention') {
      drawEmoteBubble(ctx, x + 14, topY + 2, 'alert', now, still);
    } else if (seat.status === 'accepted' && !still) {
      drawEmoteBubble(ctx, x + 14, topY + 2, 'check', now, still);
    } else if (seat.status === 'unavailable' && pose.seated) {
      // Gentle floating ZzZ sleep bubbles
      if (!still) {
        for (let i = 0; i < 2; i++) {
          const p = (t * 0.38 + i * 0.5) % 1;
          const zx = Math.round(x + 10 + p * 8);
          const zy = Math.round(topY + 4 - p * 14);
          ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85;
          px(ctx, zx, zy, 4, 1, '#d8e3f7');
          px(ctx, zx + 2, zy + 1, 1, 1, '#d8e3f7');
          px(ctx, zx + 1, zy + 2, 1, 1, '#d8e3f7');
          px(ctx, zx, zy + 3, 4, 1, '#d8e3f7');
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawLeisureFx(ctx, pose, now, still) {
    if (still || pose.walking || pose.seated) return;
    const x = Math.round(pose.x);
    const topY = Math.round(pose.foot - 56);
    if (pose.activity === 'tea') drawEmoteBubble(ctx, x + 12, topY + 4, 'tea', now, still);
    else if (pose.activity === 'window') drawEmoteBubble(ctx, x + 12, topY + 4, 'star', now, still);
    else if (pose.activity === 'pond') drawEmoteBubble(ctx, x + 12, topY + 4, 'fish', now, still);
    else if (pose.activity === 'garden' || pose.activity === 'porch') drawEmoteBubble(ctx, x + 12, topY + 4, 'music', now, still);
    else if (pose.activity === 'hearth') drawEmoteBubble(ctx, x + 12, topY + 4, 'heart', now, still);
    else if (pose.activity === 'books') drawEmoteBubble(ctx, x + 12, topY + 4, 'star', now, still);
  }

  function drawWeatherAndGlow(ctx, pal, weather, now, still, burstParticles) {
    const t = still ? 0 : now * 0.001;

    // 1. Outdoor Garden Lantern & Porch Warm Glow (stronger at dusk/night)
    if (pal.lampGlow > 0.3) {
      for (const [gx, gy, r] of [[516, 228, 34], [468, 178, 26]]) {
        const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, r);
        grad.addColorStop(0, `rgba(255, 224, 140, ${pal.lampGlow * 0.58})`);
        grad.addColorStop(1, 'rgba(255, 224, 140, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
    }

    // 2. Weather & Season Ambient Particles
    if (!still) {
      if (weather === 'sakura') {
        for (let i = 0; i < 16; i++) {
          const pxPos = Math.round(((i * 47 + t * (16 + (i % 4) * 4)) % 670) - 15);
          const pyPos = Math.round(((i * 31 + t * (14 + (i % 3) * 4)) % 370) - 5);
          const sway = Math.round(Math.sin(t * 2.5 + i) * 3);
          px(ctx, pxPos + sway, pyPos, 3, 2, i % 2 === 0 ? '#ffc2d6' : '#ffe4ee');
        }
      } else if (weather === 'fireflies') {
        for (let i = 0; i < 14; i++) {
          const base = i < 9 ? 478 + (i * 17) % 150 : 30 + (i * 83) % 410;
          const baseY = i < 9 ? 90 + (i * 39) % 240 : 140 + (i * 41) % 180;
          const fx = Math.round(base + Math.sin(t * (0.9 + (i % 3) * 0.3) + i * 2.1) * 14);
          const fy = Math.round(baseY + Math.cos(t * (1.1 + (i % 2) * 0.4) + i) * 10);
          const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.4 + i * 1.9));
          ctx.fillStyle = `rgba(232, 255, 138, ${glow * 0.35})`;
          ctx.fillRect(fx - 2, fy - 2, 6, 6);
          ctx.fillStyle = `rgba(255, 252, 186, ${glow})`;
          ctx.fillRect(fx, fy, 2, 2);
        }
      } else if (weather === 'rain') {
        ctx.fillStyle = 'rgba(182, 220, 255, 0.52)';
        for (let i = 0; i < 36; i++) {
          // Keep rain mainly outdoors & across sky/windows!
          const rx = Math.round(((i * 29 - t * 65) % 660 + 660) % 660);
          const ry = Math.round(((i * 37 + t * 190) % 360));
          const indoors = rx > 18 && rx < 464 && ry > 62 && ry < 340;
          if (!indoors) {
            ctx.fillRect(rx, ry, 1, 6);
            ctx.fillRect(rx - 1, ry + 5, 1, 2);
          }
        }
      } else {
        // Gentle sunny breeze dust motes / tiny butterflies in garden
        for (let i = 0; i < 2; i++) {
          const bx = Math.round(545 + Math.sin(t * 1.3 + i * 3.1) * 34);
          const by = Math.round(255 + Math.cos(t * 1.9 + i * 2.4) * 26);
          const wing = Math.floor(now / 160) % 2;
          const col = i === 0 ? '#ffe066' : '#a8e6ff';
          px(ctx, bx - 2, by - wing, 2, 2, col);
          px(ctx, bx + 1, by - wing, 2, 2, col);
          px(ctx, bx, by, 1, 2, '#4a352a');
        }
      }
    }

    // 3. Burst Particles from User Clicks / Celebrations!
    for (const p of burstParticles) {
      const progress = (now - p.start) / p.duration;
      if (progress < 0 || progress > 1) continue;
      const x = Math.round(p.x + p.vx * progress);
      const y = Math.round(p.y + p.vy * progress + 18 * progress * progress);
      ctx.globalAlpha = Math.max(0, 1 - progress * 0.9);
      if (p.kind === 'heart') drawPixelHeart(ctx, x - 3, y - 3, p.color);
      else if (p.kind === 'star') drawPixelStar(ctx, x - 2, y - 2, p.color);
      else px(ctx, x, y, p.size || 3, p.size || 2, p.color);
      ctx.globalAlpha = 1;
    }

    // 4. Subtle Atmospheric Tint for Dusk/Night
    if (pal.ambientTint) {
      ctx.fillStyle = pal.ambientTint;
      ctx.fillRect(0, 0, 640, 360);
    }
  }

  function drawHoverOutline(ctx, box) {
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 232, 138, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(Math.round(box.x) + 0.5, Math.round(box.y) + 0.5, Math.round(box.w), Math.round(box.h));
    ctx.restore();
  }

  function drawSpeechBanner(ctx, x, y, text) {
    if (!text) return;
    ctx.save();
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    const maxChars = 24;
    const shown = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
    const padX = 7;
    const w = Math.min(220, Math.ceil(ctx.measureText(shown).width) + padX * 2);
    const h = 19;
    const bx = Math.max(8, Math.min(632 - w, Math.round(x - w / 2)));
    const by = Math.max(8, Math.round(y - h - 6));

    // Pixel-framed Stardew cream dialogue box
    px(ctx, bx - 1, by, w + 2, h, '#4a3122');
    px(ctx, bx, by - 1, w, h + 2, '#4a3122');
    px(ctx, bx, by, w, h, '#fff8e6');
    px(ctx, bx + 1, by + 1, w - 2, 1, '#ffffff');
    px(ctx, bx + 1, by + h - 2, w - 2, 1, '#e8d5b5');
    // Speech pointer triangle
    const tailX = Math.max(bx + 8, Math.min(bx + w - 10, Math.round(x)));
    px(ctx, tailX - 2, by + h, 5, 2, '#fff8e6');
    px(ctx, tailX - 1, by + h + 2, 3, 1, '#4a3122');

    ctx.fillStyle = '#3b2619';
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, bx + padX, by + h / 2 + 0.5);
    ctx.restore();
  }

  window.ModelDeskOfficeScene = {
    PALETTES,
    LAYOUT,
    resolvePalette,
    buildBackground,
    drawSkyDynamic,
    drawSunBeams,
    drawHearthAndCat,
    drawTeaAndMusicDynamic,
    drawPondDynamic,
    drawTreeCanopy,
    drawBoardNotes,
    drawLeadStation,
    drawWorkerDesk,
    drawEmoteBubble,
    drawWorkStateFx,
    drawLeisureFx,
    drawWeatherAndGlow,
    drawHoverOutline,
    drawSpeechBanner,
    drawPixelHeart,
    drawPixelStar,
    px,
  };
}());
