# Firewall on arch

Keeps other devices out of the k3s networks, so llmgw and mcpgw are reachable only from arch
([ADR 0008](../../docs/adr/0008-only-arch-and-the-cluster-no-auth.md)).

```sh
sudo install -Dm644 deploy/host/arch-only.nft /etc/nftables.d/arch-only.nft
sudo install -Dm644 deploy/host/arch-only-firewall.service /etc/systemd/system/arch-only-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now arch-only-firewall
```

It has its own service rather than `nftables.service`, and only ever touches its own table, so it can't disturb k3s's rules.

- **Check it:** `sudo nft list table inet arch_only`.
- **Undo it:** `sudo systemctl disable --now arch-only-firewall`.
- **Ollama:** to block it from other devices too, uncomment the two lines in `arch-only.nft` and
  `sudo systemctl restart arch-only-firewall`. llmgw isn't affected.

**Tested** in a throwaway network namespace with a veth named like a Wi-Fi card, not on the real network: a simulated LAN
device reaches the Service and pod ranges without the rule and is blocked with it, while Traefik and arch itself keep
working. To test it for real from another machine: `sudo ip route add 10.43.0.0/16 via 192.168.1.163`, then
`curl -m 5 http://10.43.151.52/` should time out. Remove the route afterwards.
