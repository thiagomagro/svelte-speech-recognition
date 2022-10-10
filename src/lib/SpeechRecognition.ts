/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    commandToRegExp,
    compareTwoStringsUsingDiceCoefficient,
    browserSupportsPolyfills
} from './utils'
import { browser } from '$app/environment';
import isAndroid from './isAndroid';
import RecognitionManager from './RecognitionManager'
import { derived, get, writable, type Writable } from 'svelte/store';
import { NativeSpeechRecognition } from './NativeSpeechRecognition'
import type { SpeechRecognitionClass, SpeechRecognition as PolyfillSpeechRecognitionType } from '@speechly/speech-recognition-polyfill';


let _browserSupportsSpeechRecognition = !!NativeSpeechRecognition
let _browserSupportsContinuousListening = _browserSupportsSpeechRecognition && !isAndroid()
let recognitionManager: RecognitionManager;

type TranscriptStore = { interimTranscript: string, finalTranscript: string[] };
const useSpeechRecognition = ({
    transcribing = true,
    clearTranscriptOnListen = true,
    commands = []
} = {}) => {
    const recognitionManager = SpeechRecognition.getRecognitionManager();

    // Stores to be used in Svelte files
    const transcribingStore = writable(transcribing);
    const transcriptStore: Writable<TranscriptStore> = writable({ interimTranscript: '', finalTranscript: [] });
    const clearTranscriptOnListenStore = writable(clearTranscriptOnListen);
    const listeningReadable = derived(recognitionManager.listening, $listening => $listening);

    // Maybe keep, interimTranscript and finalTranscript in separate stores to match react-speech-recognition
    const interimTranscript = derived(transcriptStore, $transcript => $transcript.interimTranscript);
    const finalTranscript = derived(transcriptStore, $transcript => $transcript.finalTranscript);

    const browserSupportsSpeechRecognition = !browser ? true : _browserSupportsSpeechRecognition;
    const browserSupportsContinuousListening = _browserSupportsContinuousListening;
    let isMicrophoneAvailable = recognitionManager.isMicrophoneAvailable

    const clearTranscript = () => {
        transcriptStore.set({ interimTranscript: '', finalTranscript: [] })
    };

    const resetTranscript = () => {
        console.log('Hit reset transcript.');
        recognitionManager.resetTranscript()
        clearTranscript()
    };

    const testFuzzyMatch = (command: any, input: string, fuzzyMatchingThreshold: number) => {
        console.log("testFuzzyMatch: ", { command, input, fuzzyMatchingThreshold });
        const commandToString = (typeof command === 'object') ? command.toString() : command
        const commandWithoutSpecials = commandToString
            .replace(/[&/\\#,+()!$~%.'":*?<>{}]/g, '')
            .replace(/  +/g, ' ')
            .trim()
        const howSimilar = compareTwoStringsUsingDiceCoefficient(commandWithoutSpecials, input)
        if (howSimilar >= fuzzyMatchingThreshold) {
            return {
                command,
                commandWithoutSpecials,
                howSimilar,
                isFuzzyMatch: true
            }
        }
        return null
    }

    const testMatch = (command: any, input: string) => {
        const pattern = commandToRegExp(command)
        const result = pattern.exec(input)
        if (result) {
            return {
                command,
                parameters: result.slice(1)
            }
        }
        return null
    }

    const matchCommands = (newInterimTranscript: string, newFinalTranscript: string) => {
        commands.forEach(({
            command,
            callback,
            matchInterim = false,
            isFuzzyMatch = false,
            fuzzyMatchingThreshold = 0.8,
            bestMatchOnly = false
        }) => {
            const input = !newFinalTranscript && matchInterim
                ? newInterimTranscript.trim()
                : newFinalTranscript.trim()
            const subcommands = Array.isArray(command) ? command : [command]
            const results = subcommands.map(subcommand => {
                if (isFuzzyMatch) {
                    return testFuzzyMatch(subcommand, input, fuzzyMatchingThreshold)
                }
                return testMatch(subcommand, input)
            }).filter(x => x)
            if (isFuzzyMatch && bestMatchOnly && results.length >= 2) {
                //@ts-expect-error Fix later
                results.sort((a, b) => b.howSimilar - a.howSimilar)
                const command = results[0]?.command;
                //@ts-expect-error Fix later
                const commandWithoutSpecials = results[0]?.commandWithoutSpecials;
                //@ts-expect-error Fix later
                const howSimilar = results[0]?.howSimilar;

                callback(commandWithoutSpecials, input, howSimilar, { command, resetTranscript })
            } else {
                results.forEach(result => {
                    //@ts-expect-error Fix later
                    if (result.isFuzzyMatch) {
                        //@ts-expect-error Fix later
                        const { command, commandWithoutSpecials, howSimilar } = result
                        callback(commandWithoutSpecials, input, howSimilar, { command, resetTranscript })
                    } else {
                        //@ts-expect-error Fix later
                        const { command, parameters } = result
                        callback(...parameters, { command, resetTranscript })
                    }
                })
            }
        })
    }

    const handleTranscriptChange = (newInterimTranscript: string, newFinalTranscript: string) => { // Handle this with a svelte store
        console.log("handleTranscriptChange: ", { newInterimTranscript, newFinalTranscript });
        const isTranscribing = get(transcribingStore);
        if (isTranscribing) {
            transcriptStore.update(n => {

                n.interimTranscript = newInterimTranscript;
                if (newFinalTranscript)
                    n.finalTranscript = [...n.finalTranscript, newFinalTranscript];

                return n;
            })
        }
        matchCommands(newInterimTranscript, newFinalTranscript)
    }

    const handleClearTranscript = () => {
        console.log("handleClearTranscript");
        const clearTranscriptOnListenValue = get(clearTranscriptOnListenStore);
        if (clearTranscriptOnListenValue) {
            clearTranscript()
        }
    }

    // Old use effect block
    const id = SpeechRecognition.counter
    SpeechRecognition.counter += 1

    const callbacks = {
        onListeningChange: (newListening: boolean) => recognitionManager.listening.set(newListening),
        onMicrophoneAvailabilityChange: (newMicrophoneAvailability: boolean) => isMicrophoneAvailable = newMicrophoneAvailability,
        onTranscriptChange: handleTranscriptChange,
        onClearTranscript: handleClearTranscript,
    }
    recognitionManager.subscribe(id, callbacks)
    // Old use effect block

    return {
        transcribing: transcribingStore,
        clearTranscriptOnListen: clearTranscriptOnListenStore,
        listening: listeningReadable,
        isMicrophoneAvailable,
        resetTranscript,
        browserSupportsSpeechRecognition,
        browserSupportsContinuousListening,
        transcriptStore,
        interimTranscript,
        finalTranscript,
    }
}

export type startListeningInput = { continuous?: boolean, language?: string };
export interface SpeechRecognitionType {
    counter: number,
    applyPolyfill: (input: SpeechRecognitionClass) => void,
    getRecognitionManager: () => RecognitionManager,
    getRecognition: () => PolyfillSpeechRecognitionType | null,
    startListening: (input: startListeningInput) => void,
    stopListening: () => void,
    abortListening: () => void,
    browserSupportsSpeechRecognition: () => boolean,
    browserSupportsContinuousListening: () => boolean,
}
const SpeechRecognition: SpeechRecognitionType = {
    counter: 0,
    applyPolyfill: (PolyfillSpeechRecognition: SpeechRecognitionClass) => {
        console.log("applyPolyfill");
        if (recognitionManager) {
            recognitionManager.setSpeechRecognition(PolyfillSpeechRecognition)
        } else {
            recognitionManager = new RecognitionManager(PolyfillSpeechRecognition)
        }
        const browserSupportsPolyfill = !!PolyfillSpeechRecognition && browserSupportsPolyfills()
        _browserSupportsSpeechRecognition = browserSupportsPolyfill
        _browserSupportsContinuousListening = browserSupportsPolyfill
    },
    getRecognitionManager: () => {
        console.log("getRecognitionManager");
        if (!recognitionManager) {
            recognitionManager = new RecognitionManager(NativeSpeechRecognition)
        }
        return recognitionManager
    },
    getRecognition: () => {
        console.log("getRecognition");
        const recognitionManager = SpeechRecognition.getRecognitionManager()
        return recognitionManager.getRecognition()
    },
    startListening: async ({ continuous = false, language = 'en-US' } = {}) => {
        console.log("startListening: ", { continuous, language });
        const recognitionManager = SpeechRecognition.getRecognitionManager()
        await recognitionManager.startListening({ continuous, language })
    },
    stopListening: async () => {
        console.log("Stop listening");
        const recognitionManager = SpeechRecognition.getRecognitionManager()
        await recognitionManager.stopListening()
    },
    abortListening: async () => {
        console.log("Abort listening");
        const recognitionManager = SpeechRecognition.getRecognitionManager()
        await recognitionManager.abortListening()
    },
    browserSupportsSpeechRecognition: () => _browserSupportsSpeechRecognition,
    browserSupportsContinuousListening: () => _browserSupportsContinuousListening
}

export { useSpeechRecognition }
export default SpeechRecognition
