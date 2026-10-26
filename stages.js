// ステージデータ（ステージを増やすときは STAGES に追加するだけ）
const TILE = { EMPTY: 0, GROUND: 1, BRICK: 2, QUESTION: 3, USED: 4, HARD: 5, PIPE: 6 };

const STAGES = [
  {
    name: '1-1',
    cols: 160,       // ステージの横幅（タイル数）
    flagCol: 148,    // ゴールの旗の列
    time: 300,       // 制限時間
    startX: 40,      // スタート位置(px)

    // set(c, r, tile) でタイルを置く。敵・コイン・ブロックの中身を返す。
    build(set) {
      const { GROUND, BRICK, QUESTION, HARD, PIPE } = TILE;

      // 地面（穴あり）
      const pits = [[34, 2], [66, 3], [98, 3], [118, 2]];
      for (let c = 0; c < this.cols; c++) {
        if (pits.some(([s, w]) => c >= s && c < s + w)) continue;
        set(c, 13, GROUND); set(c, 14, GROUND);
      }
      // 土管
      const pipe = (c, h) => { for (let r = 13 - h; r < 13; r++) { set(c, r, PIPE); set(c + 1, r, PIPE); } };
      pipe(24, 2); pipe(42, 3); pipe(54, 2); pipe(104, 3);
      // ブロック
      const q = (c, r) => set(c, r, QUESTION);
      const b = (c, r) => set(c, r, BRICK);
      q(14, 9); b(17, 9); q(18, 9); b(19, 9); q(20, 9); q(18, 5);
      b(46, 9); b(47, 9); q(48, 9); b(49, 9);
      for (let c = 58; c < 66; c++) b(c, 6);
      q(60, 9); q(61, 9);
      b(76, 9); q(77, 9); b(78, 9);
      b(88, 9); b(89, 9); b(90, 9); q(89, 5);
      b(108, 9); q(109, 9); b(110, 9);
      q(122, 9); b(123, 9); q(124, 9);
      // 階段
      for (let i = 1; i <= 8; i++) for (let h = 0; h < i; h++) set(130 + i, 12 - h, HARD);

      return {
        // 敵の出現列
        enemies: [20, 30, 38, 50, 62, 70, 72, 84, 92, 94, 112, 114, 126],
        // 空中コイン [列, 行, 個数]
        coins: [[30, 9, 3], [60, 4, 5], [96, 8, 5], [116, 7, 4], [136, 3, 3]],
        // ? ブロックの中身（指定なしはコイン）"列,行": 'mushroom' | 'star'
        contents: {
          '18,9': 'mushroom',
          '48,9': 'mushroom',
          '89,5': 'star',
          '109,9': 'mushroom',
          '124,9': 'star'
        }
      };
    }
  }
];
