import { ToggleButton, ToggleButtonGroup } from 'react-aria-components/ToggleButtonGroup'
import type { FilterChipsProps } from './FilterChips'

export function AriaFilterChips({ label, options, selected, onSelect }: FilterChipsProps) {
  return (
    <ToggleButtonGroup
      className="site-filters"
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[selected]}
      onSelectionChange={keys => {
        const id = keys.values().next().value
        if (typeof id === 'string') onSelect(id)
      }}
    >
      {options.map(option => <ToggleButton id={option.id} key={option.id}>{option.label}</ToggleButton>)}
    </ToggleButtonGroup>
  )
}
