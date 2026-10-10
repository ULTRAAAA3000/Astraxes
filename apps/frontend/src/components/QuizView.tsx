import { useState } from 'react'
import type { QuizQuestion } from '../lib/api'
import { Icon } from './Icons'

const LETTERS = ['A', 'B', 'C', 'D']

function optionClass(answered: number | null, correct: number, index: number): string {
  if (answered === null) return 'opt'
  if (index === correct) return 'opt opt-correct'
  if (index === answered) return 'opt opt-wrong'
  return 'opt opt-dim'
}

function verdict(score: number, total: number): string {
  const ratio = total === 0 ? 0 : score / total
  if (ratio === 1) return 'Бездоганно'
  if (ratio >= 0.75) return 'Дуже добре'
  if (ratio >= 0.5) return 'Непогано, є що повторити'
  return 'Варто ще раз перечитати конспект'
}

export default function QuizView({ questions }: { questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null))
  const answered = answers.filter((value) => value !== null).length
  const score = answers.reduce<number>((sum, value, index) => (value === questions[index].correctIndex ? sum + 1 : sum), 0)
  const finished = answered === questions.length

  const choose = (questionIndex: number, optionIndex: number) => {
    setAnswers((prev) => (prev[questionIndex] !== null ? prev : prev.map((value, i) => (i === questionIndex ? optionIndex : value))))
  }

  const reset = () => setAnswers(questions.map(() => null))

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>
            Відповіді: {answered} з {questions.length}
          </span>
          <span>Правильно: {score}</span>
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
      </div>

      {questions.map((item, questionIndex) => {
        const selected = answers[questionIndex]
        const isRight = selected === item.correctIndex
        return (
          <div key={questionIndex} className="card reveal p-5 sm:p-6" style={{ animationDelay: `${questionIndex * 60}ms` }}>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">
              Питання {questionIndex + 1} з {questions.length}
            </p>
            <h3 className="mt-2 text-lg font-semibold leading-snug tracking-tight">{item.question}</h3>
            <div className="mt-4 space-y-2">
              {item.options.map((option, optionIndex) => (
                <button
                  key={optionIndex}
                  type="button"
                  disabled={selected !== null}
                  onClick={() => choose(questionIndex, optionIndex)}
                  className={optionClass(selected, item.correctIndex, optionIndex)}
                >
                  <span className="opt-letter">{LETTERS[optionIndex]}</span>
                  <span className="flex-1 text-left">{option}</span>
                  {selected !== null && optionIndex === item.correctIndex && <Icon name="check" className="h-4 w-4 shrink-0" />}
                  {selected !== null && optionIndex === selected && optionIndex !== item.correctIndex && <Icon name="x" className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </div>
            {selected !== null && (
              <div className={`reveal mt-4 rounded-2xl px-4 py-3 text-sm ${isRight ? 'notice-ok' : 'notice-bad'}`}>
                <p className="font-semibold">{isRight ? 'Правильно' : `Неправильно. Правильна відповідь: ${LETTERS[item.correctIndex]}`}</p>
                <p className="mt-1 text-muted">{item.explanation}</p>
              </div>
            )}
          </div>
        )
      })}

      {finished && (
        <div className="reveal rounded-3xl bg-inv p-8 text-center text-inv-fg shadow-lg-soft">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-inv-muted">Результат</p>
          <p className="font-display mt-2 text-6xl">
            {score}
            <span className="text-inv-muted"> / {questions.length}</span>
          </p>
          <p className="mt-2 text-sm text-inv-muted">{verdict(score, questions.length)}</p>
          <button type="button" onClick={reset} className="btn btn-invert mt-6">
            <Icon name="refresh" />
            Пройти ще раз
          </button>
        </div>
      )}
    </div>
  )
}
