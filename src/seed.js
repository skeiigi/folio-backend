import { randomUUID } from "node:crypto";
import { one } from "./db.js";
import { hashPassword } from "./auth.js";
import { poster, createGlb } from "./demo-media.js";
import { createStorage } from "./storage.js";

export const DEMO_IDS = {
  client: "10000000-0000-4000-8000-000000000001",
  mira: "10000000-0000-4000-8000-000000000002",
  lea: "10000000-0000-4000-8000-000000000003",
  nikita: "10000000-0000-4000-8000-000000000004",
  admin: "10000000-0000-4000-8000-000000000005",
  profile: "20000000-0000-4000-8000-000000000001",
};
export async function seedDatabase(db, config, password) {
  const users = [
    ["Антон", "anton", "client"],
    ["Мира Волкова", "mira", "author"],
    ["Лея Морозова", "lea", "author"],
    ["Никита Ким", "nikita", "author"],
    ["Администратор", "admin", "admin"],
  ];
  const ids = [
    DEMO_IDS.client,
    DEMO_IDS.mira,
    DEMO_IDS.lea,
    DEMO_IDS.nikita,
    DEMO_IDS.admin,
  ];
  for (let i = 0; i < users.length; i++) {
    const [name, email, role] = users[i];
    await db.query(
      "INSERT INTO users(id,email,password_hash,name,roles) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",
      [
        ids[i],
        `${email}@folio.test`,
        await hashPassword(password),
        name,
        JSON.stringify(
          role === "client"
            ? ["client"]
            : role === "admin"
              ? ["client", "author", "admin"]
              : ["client", "author"],
        ),
      ],
    );
  }
  const profiles = [
    {
      id: DEMO_IDS.profile,
      user: DEMO_IDS.mira,
      name: "Мира Волкова",
      specialization: ["3D-моделирование", "Stylized", "Окружение"],
      description:
        "Создаю маленькие миры с большой историей. Делаю стилизованные пропсы и окружение для инди-игр: от первого блокаута до готовой модели. Люблю тёплый свет, простые формы и детали, которые хочется разглядывать.",
      accent: "#28634b",
      theme: "paper",
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      user: DEMO_IDS.lea,
      name: "Лея Морозова",
      specialization: ["Иллюстрация", "Концепт-арт", "Персонажи"],
      description:
        "Рассказываю истории через цвет и силуэт. Рисую иллюстрации, фантастические миры и визуальные концепции. Работаю с небольшими командами и самостоятельными проектами.",
      accent: "#865852",
      theme: "paper",
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      user: DEMO_IDS.nikita,
      name: "Никита Ким",
      specialization: ["Анимация", "Motion design", "3D"],
      description:
        "Даю идеям движение. Создаю короткие 3D-анимации, заставки и предметные визуализации. Нахожу ритм даже в самых простых формах.",
      accent: "#7a5c99",
      theme: "night",
    },
  ];
  for (const p of profiles)
    await db.query(
      "INSERT INTO creator_profiles(id,user_id,public_name,specialization,description,layout_config,status) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,'published') ON CONFLICT DO NOTHING",
      [
        p.id,
        p.user,
        p.name,
        JSON.stringify(p.specialization),
        p.description,
        JSON.stringify({
          theme: p.theme,
          accent: p.accent,
          font: "sans",
          sections: ["portfolio", "services", "about"],
          hiddenSections: [],
          columns: 3,
        }),
      ],
    );
  const works = [
    [
      "30000000-0000-4000-8000-000000000001",
      profiles[0].id,
      "Тихий уголок",
      "model3d",
      "Stylized",
      0,
      "Небольшой домик лесника на островке. Учебная сцена с простыми формами, тёплыми материалами и атмосферой тихого утра. Модель можно рассмотреть со всех сторон.",
    ],
    [
      "30000000-0000-4000-8000-000000000002",
      profiles[1].id,
      "Пыль далёких миров",
      "illustration",
      "Sci-fi",
      1,
      "Иллюстрация о путешествии в неизвестность. Контраст холодного пейзажа и тёплой планеты помогает передать масштаб и одиночество исследователя.",
    ],
    [
      "30000000-0000-4000-8000-000000000003",
      profiles[1].id,
      "Маленькая оранжерея",
      "illustration",
      "Botanical",
      2,
      "Исследование спокойных природных оттенков и органических форм. Цифровая иллюстрация для небольшого редакционного проекта о доме и заботе.",
    ],
    [
      "30000000-0000-4000-8000-000000000004",
      profiles[0].id,
      "Солнечный помощник",
      "model3d",
      "Low-poly",
      3,
      "Дружелюбный робот для стилизованной игры. Простая геометрия, выразительный силуэт и материалы, которые хорошо читаются с игровой камеры.",
    ],
    [
      "30000000-0000-4000-8000-000000000005",
      profiles[2].id,
      "Движение света",
      "animation",
      "Abstract",
      4,
      "Небольшой эксперимент с ритмом, объёмом и взаимодействием простых форм. Зацикленная анимация с мягким движением.",
    ],
    [
      "30000000-0000-4000-8000-000000000006",
      profiles[0].id,
      "По дороге к горам",
      "illustration",
      "Landscape",
      5,
      "Цветовой набросок будущей игровой локации. Слои горных силуэтов, спокойный свет и тропинка, ведущая зрителя через пейзаж.",
    ],
  ];
  const storage = createStorage(db, config);
  for (const [id, profile, title, type, style, kind, description] of works) {
    await db.query(
      "INSERT INTO artworks(id,author_profile_id,title,description,work_type,style,technical_details,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'published') ON CONFLICT DO NOTHING",
      [
        id,
        profile,
        title,
        description,
        type,
        style,
        JSON.stringify(
          type === "model3d"
            ? {
                polygonCount: 1200,
                textureResolution: "Vertex colors",
                software: "Blender / procedural GLB",
                engine: "Любой glTF-совместимый",
              }
            : { software: "Цифровая графика" },
        ),
      ],
    );
    const media = [["cover", poster(kind), "image/svg+xml", "cover.svg"]];
    if (type === "model3d")
      media.push([
        "model",
        createGlb(kind === 3 ? 1 : 0),
        "model/gltf-binary",
        "folio-demo.glb",
      ]);
    if (type === "animation")
      media.push(["preview", poster(kind), "image/svg+xml", "animation.svg"]);
    for (const [purpose, bytes, mime, fileName] of media) {
      if (
        await one(
          db,
          "SELECT id FROM media_files WHERE artwork_id=$1 AND purpose=$2",
          [id, purpose],
        )
      )
        continue;
      const fileId = randomUUID(),
        key = `demo/${fileId}`;
      await storage.put(key, bytes, mime);
      await db.query(
        "INSERT INTO media_files(id,artwork_id,purpose,file_name,storage_key,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [fileId, id, purpose, fileName, key, mime, bytes.length],
      );
    }
  }
  const services = [
    [
      "Игровой пропс",
      profiles[0].id,
      "Стилизованная модель по вашему концепту: блокинг, геометрия, материалы и проверка в движке.",
      5000,
      15000,
      5,
    ],
    [
      "Модульное окружение",
      profiles[0].id,
      "Набор согласованных модулей для небольшой игровой локации. Состав и сложность обсуждаем по брифу.",
      20000,
      60000,
      14,
    ],
    [
      "Цифровая иллюстрация",
      profiles[1].id,
      "Иллюстрация для обложки, статьи или самостоятельного проекта. От эскиза до финального изображения.",
      8000,
      25000,
      7,
    ],
    [
      "Короткая 3D-анимация",
      profiles[2].id,
      "Зацикленная предметная анимация до десяти секунд: концепция, сцена, движение и финальный ролик.",
      12000,
      35000,
      10,
    ],
  ];
  for (let i = 0; i < services.length; i++) {
    const [title, p, description, min, max, days] = services[i];
    await db.query(
      "INSERT INTO services(id,author_profile_id,title,description,price_range,estimated_days,revision_rounds,status) VALUES($1,$2,$3,$4,$5::jsonb,$6,2,'active') ON CONFLICT DO NOTHING",
      [
        `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        p,
        title,
        description,
        JSON.stringify({ min, max, currency: "RUB" }),
        days,
      ],
    );
  }
  for (let i = 0; i < 3; i++) {
    const id = `50000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const status = ["submitted", "in_discussion", "accepted"][i];
    const title = [
      "Пропсы для небольшого игрового мира",
      "Иллюстрация для страницы проекта",
      "Анимация для заставки",
    ][i];
    const deadline = new Date(Date.now() + (30 + i * 7) * 86400000)
      .toISOString()
      .slice(0, 10);
    const previous = await one(db, "SELECT id FROM briefs WHERE id=$1", [id]);
    if (previous) continue;
    await db.query(
      "INSERT INTO briefs(id,client_user_id,author_profile_id,title,description,budget_range,desired_deadline,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [
        id,
        DEMO_IDS.client,
        profiles[i].id,
        title,
        "Учебный пример брифа: нужен визуальный материал в стилистике портфолио автора. Объём, форматы и требования обсудим до начала работы.",
        JSON.stringify({ min: 15000, max: 30000, currency: "RUB" }),
        deadline,
        status,
      ],
    );
    await db.query(
      "INSERT INTO brief_events(id,brief_id,actor_user_id,to_status,message) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        id,
        DEMO_IDS.client,
        status,
        "Тестовая запись для демонстрации MVP",
      ],
    );
  }
}
