# openref - логотип

Направление «пропуск». Три строки записи, средняя разомкнута, пробел ограничен
двумя стойками: если факт нельзя прочитать достоверно, строка остаётся
незакрытой и помечается как неизмеренная, а не как чистая.

Открой `index.html` - там все раскладки, правила поля, масштабы и таблица
«какой файл брать».

## Цвет

| роль | светлый фон | тёмный фон |
| --- | --- | --- |
| чернила | `#14161c` | `#eef1f6` |
| акцент, только стойки пробела | `#b45309` | `#f0b429` |

## Файлы

| файл | цвет внутри | где брать |
| --- | --- | --- |
| `openref-mark-light.svg`, `openref-lockup-light.svg`, `openref-stack-light.svg`, `openref-favicon-light.svg`, `openref-mark-tight-light.svg` | литералом, чернила `#14161c`, акцент `#b45309` | светлый фон |
| `openref-mark-dark.svg`, `openref-lockup-dark.svg`, `openref-stack-dark.svg`, `openref-favicon-dark.svg`, `openref-mark-tight-dark.svg` | литералом, чернила `#eef1f6`, акцент `#f0b429` | тёмный фон |
| `openref-mark-light-mono.svg`, `openref-mark-dark-mono.svg`, `openref-lockup-light-mono.svg`, `openref-lockup-dark-mono.svg` | один цвет, литералом | печать, гравировка, один доступный цвет |
| `openref-mark-inline.svg`, `openref-lockup-inline.svg` | `currentColor` | только вставка разметки прямо в DOM |

Файла с автопереключением темы в наборе нет намеренно: медиазапрос внутри SVG
не виден, когда файл подключён картинкой, а README на GitHub тему в `img` не
пробрасывает. Переключает та сторона, которая про тему знает.

## Как подключать

README на GitHub и npm:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="openref-lockup-dark.svg" />
  <img src="openref-lockup-light.svg" width="360" alt="openref" />
</picture>
```

Фавиконка:

```html
<link rel="icon" href="openref-favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)" />
<link rel="icon" href="openref-favicon-dark.svg"  type="image/svg+xml" media="(prefers-color-scheme: dark)" />
```

В своём интерфейсе - разметка `openref-mark-inline.svg` прямо в DOM, цвет
наследуется от текста, тему решает твой CSS.

## Правила

- Марк отдельно: не меньше 16 px. На 16 и 24 px - файл favicon, у него своя
  сетка и штрихи по целым пикселям. С 32 px работает основной марк.
- Марк с надписью: не меньше 120 px по ширине. Ниже - только марк.
- Свободное поле со всех сторон - четверть высоты марка.
- Пропорции не меняются, марк не наклоняется, надпись не набирается шрифтом
  заново: она в кривых и штрихах, внешних шрифтов нет.
- Стойки не убираются: без них средняя строка читается как обрыв, а не как
  объявленный пробел.
