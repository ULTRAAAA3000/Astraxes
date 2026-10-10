export default function HowItWorksSection() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16 sm:pb-24">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-soft">Як це працює</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        Три кроки до <span className="font-display font-normal italic">готового матеріалу</span>
      </h2>
      <div className="mt-10 grid gap-8 sm:grid-cols-3">
        {[
          { n: '01', name: 'Вставте текст', text: 'Скопіюйте параграф чи лекцію або завантажте файл: PDF, Word, презентацію (.pptx), .txt чи .md.' },
          { n: '02', name: 'Оберіть формат', text: 'Конспект, тест або терміни: можна вибрати все одразу.' },
          { n: '03', name: 'Отримайте результат', text: 'Результат зберігається в історії, його можна відкрити пізніше.' }
        ].map((item) => (
          <div key={item.n} className="border-t border-line-strong pt-5">
            <p className="font-display text-4xl text-soft">{item.n}</p>
            <p className="mt-3 text-lg font-semibold tracking-tight">{item.name}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
