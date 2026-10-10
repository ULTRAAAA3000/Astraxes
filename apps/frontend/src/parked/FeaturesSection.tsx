import { Icon } from '../components/Icons'
import type { IconName } from '../components/Icons'

export default function FeaturesSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-16 sm:pb-20">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: 'doc' as IconName, name: 'Конспект', text: 'Жорстка ієрархія «Тема → Ключові поняття → Факти». Лише суть, тези до 15 слів.' },
          { icon: 'lines' as IconName, name: 'Переказ', text: 'Короткий зв’язний переказ у 4–6 речень: головна думка й ключові факти без зайвого.' },
          { icon: 'check-list' as IconName, name: 'Тест', text: 'Від 4 до 10 питань: визначення, причинно-наслідкові зв’язки та факти. З поясненнями.' },
          { icon: 'tag' as IconName, name: 'Терміни', text: 'Картки ключових термінів із короткими визначеннями прямо з вашого тексту.' }
        ].map((item, index) => (
          <div key={item.name} className="card card-hover reveal p-6" style={{ animationDelay: `${index * 80}ms` }}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-inv text-inv-fg">
              <Icon name={item.icon} className="h-5 w-5" />
            </span>
            <p className="mt-5 text-lg font-semibold tracking-tight">{item.name}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
