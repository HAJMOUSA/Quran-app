import { render, fireEvent, screen } from "@testing-library/react-native";
import { MushafPage } from "./MushafPage";
import type { WordRow } from "../db/schema";

const w = (id: number, verse_key: string, position: number, line: number, code_v2: string): WordRow =>
  ({ id, verse_key, surah: 1, ayah: Number(verse_key.split(":")[1]), position, page: 1, line, char_type: "word", code_v2, gidx: id - 1 });

const words: WordRow[] = [
  w(1, "1:1", 1, 2, "ﱁ"),
  w(2, "1:1", 2, 2, "ﱂ"),
  w(3, "1:2", 1, 3, "ﱃ"),
];

// NOTE: @testing-library/react-native v14 makes `render` async and exposes
// queries via the `screen` global (the destructured return value is empty),
// so tests await render and query through `screen`.
test("renders a pressable span per word", async () => {
  await render(
    <MushafPage words={words} fontFamily="QCF2001" selectedVerseKey={null} onSelectAyah={() => {}} />,
  );
  expect(screen.getByTestId("word-1")).toBeTruthy();
  expect(screen.getByTestId("word-3")).toBeTruthy();
});

test("pressing a word fires onSelectAyah with its verse_key", async () => {
  const onSelect = jest.fn();
  await render(
    <MushafPage words={words} fontFamily="QCF2001" selectedVerseKey={null} onSelectAyah={onSelect} />,
  );
  fireEvent.press(screen.getByTestId("word-3"));
  expect(onSelect).toHaveBeenCalledWith("1:2");
});
