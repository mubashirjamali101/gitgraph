import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ConfirmDialog from '../ConfirmDialog'

const props = {
  isOpen: true,
  title: 'Force push?',
  message: 'This rewrites published history.',
  onConfirm: () => {},
  onCancel: () => {},
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...props} isOpen={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('confirms and cancels through their handlers', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...props} confirmLabel="Do it" onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByText('Do it'))
    expect(onConfirm).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('holds the confirm button until the exact phrase is typed', () => {
    // The gate exists so an irreversible action needs deliberate input, not a
    // reflexive click — it must not accept a near miss.
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog {...props} confirmLabel="Force push" typeToConfirm="main" onConfirm={onConfirm} />,
    )

    const confirm = screen.getByText('Force push')
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mai' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'main' } })
    expect(confirm).toBeEnabled()

    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog {...props} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('clears typed confirmation between openings', () => {
    // Reopening must not inherit the previous answer.
    const { rerender } = render(<ConfirmDialog {...props} typeToConfirm="main" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'main' } })
    expect(screen.getByText('Confirm')).toBeEnabled()

    rerender(<ConfirmDialog {...props} typeToConfirm="main" isOpen={false} />)
    rerender(<ConfirmDialog {...props} typeToConfirm="main" isOpen />)
    expect(screen.getByText('Confirm')).toBeDisabled()
  })
})
