export default function RetellingView({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-surface2 p-5 sm:p-7">
      <p className="text-[1.05rem] leading-8 text-fg sm:text-lg sm:leading-9">{text}</p>
    </div>
  )
}
