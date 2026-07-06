import { Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

export interface InputBoxProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholder?: string;
	history?: string[];
}

export function InputBox({
	value,
	onChange,
	onSubmit,
	placeholder = "",
	history = [],
}: InputBoxProps): ReactElement {
	const { exit } = useApp();
	const [historyIndex, setHistoryIndex] = useState(-1);
	const historyIndexRef = useRef(historyIndex);
	const draftRef = useRef(value);

	historyIndexRef.current = historyIndex;

	useEffect(() => {
		if (value === "" && historyIndexRef.current !== -1) {
			historyIndexRef.current = -1;
			setHistoryIndex(-1);
		}
	}, [value]);

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			exit();
			return;
		}

		if (key.return) {
			onSubmit();
			return;
		}

		if (key.upArrow) {
			if (history.length === 0) {
				return;
			}

			const currentIndex = historyIndexRef.current;
			if (currentIndex === -1) {
				draftRef.current = value;
				historyIndexRef.current = history.length - 1;
				setHistoryIndex(history.length - 1);
				onChange(history[history.length - 1]);
			} else if (currentIndex > 0) {
				historyIndexRef.current = currentIndex - 1;
				setHistoryIndex(currentIndex - 1);
				onChange(history[currentIndex - 1]);
			}
			return;
		}

		if (key.downArrow) {
			const currentIndex = historyIndexRef.current;
			if (currentIndex === -1 || history.length === 0) {
				return;
			}

			if (currentIndex < history.length - 1) {
				historyIndexRef.current = currentIndex + 1;
				setHistoryIndex(currentIndex + 1);
				onChange(history[currentIndex + 1]);
			} else {
				historyIndexRef.current = -1;
				setHistoryIndex(-1);
				onChange(draftRef.current);
			}
			return;
		}

		if (key.backspace || key.delete) {
			onChange(value.slice(0, -1));
			return;
		}

		if (input.length === 1 && !key.ctrl && !key.meta) {
			onChange(value + input);
		}
	});

	return (
		<Text>
			{value.length === 0 && placeholder.length > 0 ? <Text dimColor>{placeholder}</Text> : value}
		</Text>
	);
}
